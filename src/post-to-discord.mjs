import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_DISCORD_CONTENT_LENGTH = 1800;
const MAX_RETRIES = 5;
const SUPPRESS_EMBEDS_FLAG = 1 << 2;

const discordRoutesPath = new URL("../config/discord-routes.json", import.meta.url);
const discordRoutes = JSON.parse(await readFile(discordRoutesPath, "utf8"));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.DISCORD_DRY_RUN === "1";
const jsonOutput = args.includes("--json");
const suppressEmbeds = process.env.DISCORD_SUPPRESS_EMBEDS !== "0";
const reportPath = args.find((arg) => !["--dry-run", "--json"].includes(arg));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text, maxLength = 500) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function splitLongLine(line, maxLength) {
  if (line.length <= maxLength) return [line];

  const chunks = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("/"));
    const splitAt = breakAt > maxLength * 0.5 ? breakAt + 1 : maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitDiscordMessage(text, maxLength = MAX_DISCORD_CONTENT_LENGTH) {
  const chunks = [];
  let current = "";

  for (const originalLine of text.split("\n")) {
    for (const line of splitLongLine(originalLine, maxLength)) {
      const candidate = current ? `${current}\n${line}` : line;

      if (candidate.length > maxLength) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function titleFromReport(report, filePath) {
  const heading = report
    .split("\n")
    .map((line) => line.match(/^#\s+(.+?)\s*$/)?.[1])
    .find(Boolean);

  if (heading) return heading.replace(/\s+/g, " ").trim();

  return path
    .basename(filePath, path.extname(filePath))
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function routeForReport(filePath) {
  const basename = path.basename(filePath);
  const route = discordRoutes.routes?.find((candidate) => basename.endsWith(candidate.match));
  const defaultWebhookEnv = discordRoutes.defaultWebhookEnv || "DISCORD_WEBHOOK_URL";

  if (!route) {
    return {
      name: "default",
      webhookEnv: defaultWebhookEnv,
      fallbackWebhookEnv: null,
    };
  }

  return {
    name: route.name,
    webhookEnv: route.webhookEnv,
    fallbackWebhookEnv: route.fallbackWebhookEnv || null,
  };
}

function resolveWebhook(route) {
  const candidates = [route.webhookEnv, route.fallbackWebhookEnv].filter(Boolean);
  const activeWebhookEnv = candidates.find((envName) => process.env[envName]);

  return {
    routeName: route.name,
    configuredWebhookEnv: route.webhookEnv,
    webhookEnv: activeWebhookEnv || route.webhookEnv,
    webhookUrl: activeWebhookEnv ? process.env[activeWebhookEnv] : "",
    fallbackUsed: Boolean(activeWebhookEnv && activeWebhookEnv === route.fallbackWebhookEnv),
  };
}

function webhookUrlWithWait(webhookUrl) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  return url.toString();
}

function formatFetchError(error) {
  const cause = error?.cause;
  const parts = [
    "Discord webhook network request failed.",
    cause?.code ? `code=${cause.code}` : null,
    cause?.hostname ? `host=${cause.hostname}` : null,
    cause?.syscall ? `syscall=${cause.syscall}` : null,
  ].filter(Boolean);

  return parts.join(" ");
}

async function postDiscordChunk(content, webhookUrl, attempt = 1) {
  let response;

  try {
    response = await fetch(webhookUrlWithWait(webhookUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        flags: suppressEmbeds ? SUPPRESS_EMBEDS_FLAG : undefined,
        allowed_mentions: {
          parse: [],
        },
      }),
    });
  } catch (error) {
    throw new Error(formatFetchError(error), { cause: error });
  }

  if (response.status === 429 && attempt <= MAX_RETRIES) {
    const data = await response.json().catch(() => ({}));
    const retryAfter = Number(data.retry_after ?? response.headers.get("retry-after") ?? 2);
    await sleep(Math.ceil(retryAfter * 1000));
    return postDiscordChunk(content, webhookUrl, attempt + 1);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status} ${truncate(errorText)}`);
  }

  const message = await response.json().catch(() => ({}));

  return {
    id: message.id || null,
    channelId: message.channel_id || null,
    timestamp: message.timestamp || null,
  };
}

async function main() {
  if (!reportPath) {
    throw new Error(
      "Usage: npm run send-discord -- reports/YYYY-MM-DD-tech-ai-digest.md",
    );
  }

  const route = routeForReport(reportPath);
  const webhook = resolveWebhook(route);

  const report = await readFile(reportPath, "utf8");

  if (report.trim().length === 0) {
    throw new Error("Report is empty.");
  }

  if (!webhook.webhookUrl && !dryRun) {
    throw new Error(`${webhook.configuredWebhookEnv} is missing for ${webhook.routeName} Discord route.`);
  }

  const chunks = splitDiscordMessage(report);
  const reportTitle = titleFromReport(report, reportPath);

  if (dryRun) {
    const embedMode = suppressEmbeds ? "link previews suppressed" : "link previews enabled";
    const summary = {
      dryRun: true,
      reportPath,
      chunks: chunks.length,
      suppressEmbeds,
      route: webhook.routeName,
      webhookEnv: webhook.webhookEnv,
      fallbackUsed: webhook.fallbackUsed,
    };

    if (jsonOutput) {
      console.log(JSON.stringify(summary));
    } else {
      console.log(
        `Dry run: ${chunks.length} Discord message(s) would be sent from ${reportPath} via ${webhook.routeName} route using ${webhook.webhookEnv} (${embedMode}).`,
      );
    }
    return;
  }

  const messages = [];

  for (let index = 0; index < chunks.length; index++) {
    const header =
      chunks.length > 1
        ? `**${reportTitle} - Part ${index + 1}/${chunks.length}**\n\n`
        : "";

    const message = await postDiscordChunk(`${header}${chunks[index]}`, webhook.webhookUrl);
    messages.push({
      index: index + 1,
      ...message,
    });
    await sleep(1_000);
  }

  const summary = {
    dryRun: false,
    reportPath,
    chunks: chunks.length,
    suppressEmbeds,
    route: webhook.routeName,
    webhookEnv: webhook.webhookEnv,
    fallbackUsed: webhook.fallbackUsed,
    messages,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(`Sent ${chunks.length} Discord message(s) from ${reportPath}.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
