import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = new URL("..", import.meta.url).pathname;

async function withTempReport(name, content, callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "feedspot-test-"));
  const reportPath = path.join(tempDir, name);

  try {
    await writeFile(reportPath, content, "utf8");
    await callback(reportPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function dryRun(reportPath, env = {}, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    ["src/post-to-discord.mjs", "--json", "--dry-run", ...extraArgs, reportPath],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DISCORD_DRY_RUN: "",
        DISCORD_MARKETS_WEBHOOK_URL: "",
        DISCORD_MARKETS_SECONDARY_WEBHOOK_URL: "",
        ...env,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("markets route dry-run includes every configured webhook env that is set", async () => {
  await withTempReport("2099-01-01-markets-digest.md", "# Markets\n\nHello", async (reportPath) => {
    const summary = dryRun(reportPath, {
      DISCORD_MARKETS_WEBHOOK_URL: "https://discord.com/api/webhooks/primary/token",
      DISCORD_MARKETS_SECONDARY_WEBHOOK_URL: "https://discord.com/api/webhooks/secondary/token",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/default/token",
    });

    assert.equal(summary.route, "markets");
    assert.equal(summary.targetCount, 2);
    assert.equal(summary.deliveryKey, "DISCORD_MARKETS_WEBHOOK_URL,DISCORD_MARKETS_SECONDARY_WEBHOOK_URL");
    assert.deepEqual(
      summary.targets.map((target) => target.webhookEnv),
      ["DISCORD_MARKETS_WEBHOOK_URL", "DISCORD_MARKETS_SECONDARY_WEBHOOK_URL"],
    );
    assert.deepEqual(
      summary.targets.map((target) => target.fallbackUsed),
      [false, false],
    );
  });
});

test("dry-run can restrict delivery to a single configured target env", async () => {
  await withTempReport("2099-01-01-markets-digest.md", "# Markets\n\nHello", async (reportPath) => {
    const summary = dryRun(
      reportPath,
      {
        DISCORD_MARKETS_WEBHOOK_URL: "https://discord.com/api/webhooks/primary/token",
        DISCORD_MARKETS_SECONDARY_WEBHOOK_URL: "https://discord.com/api/webhooks/secondary/token",
      },
      ["--target-env=DISCORD_MARKETS_SECONDARY_WEBHOOK_URL"],
    );

    assert.equal(summary.route, "markets");
    assert.equal(summary.targetCount, 1);
    assert.equal(summary.deliveryKey, "DISCORD_MARKETS_SECONDARY_WEBHOOK_URL");
    assert.deepEqual(
      summary.targets.map((target) => target.webhookEnv),
      ["DISCORD_MARKETS_SECONDARY_WEBHOOK_URL"],
    );
  });
});

test("markets route dry-run falls back to the default webhook only when no configured primary target is set", async () => {
  await withTempReport("2099-01-01-markets-digest.md", "# Markets\n\nHello", async (reportPath) => {
    const summary = dryRun(reportPath, {
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/default/token",
    });

    assert.equal(summary.route, "markets");
    assert.equal(summary.targetCount, 1);
    assert.equal(summary.deliveryKey, "DISCORD_WEBHOOK_URL");
    assert.deepEqual(
      summary.targets.map((target) => target.webhookEnv),
      ["DISCORD_WEBHOOK_URL"],
    );
    assert.deepEqual(
      summary.targets.map((target) => target.fallbackUsed),
      [true],
    );
  });
});
