import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_DISCORD_CONTENT_LENGTH = 1950;
const MAX_RETRIES = 5;
const SUPPRESS_EMBEDS_FLAG = 1 << 2;

const discordRoutesPath = new URL("../config/discord-routes.json", import.meta.url);
const discordRoutes = JSON.parse(await readFile(discordRoutesPath, "utf8"));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.DISCORD_DRY_RUN === "1";
const jsonOutput = args.includes("--json");
const suppressEmbeds = process.env.DISCORD_SUPPRESS_EMBEDS !== "0";
const targetEnvFilters = args
  .filter((arg) => arg.startsWith("--target-env="))
  .map((arg) => arg.slice("--target-env=".length))
  .filter(Boolean);
const reportPath = args.find((arg) => !["--dry-run", "--json"].includes(arg) && !arg.startsWith("--target-env="));

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

function routeForReport(filePath) {
  const basename = path.basename(filePath);
  const route = discordRoutes.routes?.find((candidate) => basename.endsWith(candidate.match));
  const defaultWebhookEnv = discordRoutes.defaultWebhookEnv || "DISCORD_WEBHOOK_URL";

  if (!route) {
    return {
      name: "default",
      webhookEnvs: [defaultWebhookEnv],
      fallbackWebhookEnv: null,
    };
  }

  return {
    name: route.name,
    webhookEnvs: route.webhookEnvs || [route.webhookEnv],
    fallbackWebhookEnv: route.fallbackWebhookEnv || null,
  };
}

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean))];
}

function publicTarget(target) {
  return {
    configuredWebhookEnv: target.configuredWebhookEnv,
    webhookEnv: target.webhookEnv,
    fallbackUsed: target.fallbackUsed,
  };
}

function resolveDelivery(route, targetEnvFilters = []) {
  const configuredWebhookEnvs = uniqueItems(route.webhookEnvs);
  const primaryTargets = configuredWebhookEnvs
    .filter((envName) => process.env[envName])
    .map((envName) => ({
      configuredWebhookEnv: envName,
      webhookEnv: envName,
      webhookUrl: process.env[envName],
      fallbackUsed: false,
    }));

  const fallbackWebhookUrl = route.fallbackWebhookEnv ? process.env[route.fallbackWebhookEnv] : "";
  const targets = primaryTargets.length > 0
    ? primaryTargets
    : fallbackWebhookUrl
      ? [
          {
            configuredWebhookEnv: configuredWebhookEnvs[0] || route.fallbackWebhookEnv,
            webhookEnv: route.fallbackWebhookEnv,
            webhookUrl: fallbackWebhookUrl,
            fallbackUsed: true,
          },
        ]
      : [];
  const selectedTargets = targetEnvFilters.length > 0
    ? targets.filter((target) => targetEnvFilters.includes(target.webhookEnv))
    : targets;

  return {
    routeName: route.name,
    configuredWebhookEnvs,
    fallbackWebhookEnv: route.fallbackWebhookEnv,
    targets: selectedTargets,
    deliveryKey: selectedTargets.map((target) => target.webhookEnv).join(","),
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
  const delivery = resolveDelivery(route, targetEnvFilters);

  const report = await readFile(reportPath, "utf8");

  if (report.trim().length === 0) {
    throw new Error("Report is empty.");
  }

  if (delivery.targets.length === 0 && !dryRun) {
    const requiredEnvs = [...delivery.configuredWebhookEnvs, delivery.fallbackWebhookEnv]
      .filter(Boolean)
      .join(" or ");
    throw new Error(`${requiredEnvs} is missing for ${delivery.routeName} Discord route.`);
  }

  const chunks = splitDiscordMessage(report);
  if (dryRun) {
    const embedMode = suppressEmbeds ? "link previews suppressed" : "link previews enabled";
    const summary = {
      dryRun: true,
      reportPath,
      chunks: chunks.length,
      suppressEmbeds,
      route: delivery.routeName,
      webhookEnv: delivery.targets[0]?.webhookEnv || delivery.configuredWebhookEnvs[0] || delivery.fallbackWebhookEnv,
      fallbackUsed: delivery.targets.some((target) => target.fallbackUsed),
      targetCount: delivery.targets.length,
      deliveryKey: delivery.deliveryKey,
      targets: delivery.targets.map(publicTarget),
    };

    if (jsonOutput) {
      console.log(JSON.stringify(summary));
    } else {
      console.log(
        `Dry run: ${chunks.length} Discord message(s) would be sent to ${delivery.targets.length} target(s) from ${reportPath} via ${delivery.routeName} route (${embedMode}).`,
      );
    }
    return;
  }

  const messages = [];
  const targets = [];

  for (let targetIndex = 0; targetIndex < delivery.targets.length; targetIndex++) {
    const target = delivery.targets[targetIndex];
    const targetMessages = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const message = await postDiscordChunk(chunks[chunkIndex], target.webhookUrl);
      const deliveredMessage = {
        targetIndex: targetIndex + 1,
        webhookEnv: target.webhookEnv,
        index: chunkIndex + 1,
        ...message,
      };

      targetMessages.push(deliveredMessage);
      messages.push(deliveredMessage);
      await sleep(1_000);
    }

    targets.push({
      ...publicTarget(target),
      messages: targetMessages,
    });
  }

  const summary = {
    dryRun: false,
    reportPath,
    chunks: chunks.length,
    suppressEmbeds,
    route: delivery.routeName,
    webhookEnv: delivery.targets[0]?.webhookEnv,
    fallbackUsed: delivery.targets.some((target) => target.fallbackUsed),
    targetCount: delivery.targets.length,
    deliveryKey: delivery.deliveryKey,
    targets,
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
