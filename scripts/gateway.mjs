import "dotenv/config";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const label = "com.ahmetenesdur.feedspot.delivery";
const legacyLabels = ["com.ahmetenesdur.tech-ai-aggregate.delivery"];
const repoRoot = process.cwd();
const userId = process.getuid?.() ?? spawn("id", ["-u"]).stdout.trim();
const domain = `gui/${userId}`;
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const serviceTarget = serviceTargetFor(label);
const plistPath = plistPathFor(label);
const reportsDir = path.join(repoRoot, "reports");
const logsDir = path.join(repoRoot, "logs");
const gatewayDir = path.join(repoRoot, ".gateway");
const discordRoutesPath = path.join(repoRoot, "config", "discord-routes.json");
const logPath = path.join(logsDir, "delivery.log");
const command = "npm run deliver-pending";

const commandName = process.argv[2] || "help";
const sendExisting = process.argv.includes("--send-existing");

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function spawn(commandToRun, args, options = {}) {
  return spawnSync(commandToRun, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
}

function serviceTargetFor(serviceLabel) {
  return `${domain}/${serviceLabel}`;
}

function plistPathFor(serviceLabel) {
  return path.join(launchAgentsDir, `${serviceLabel}.plist`);
}

function run(commandToRun, args, options = {}) {
  const result = spawn(commandToRun, args, options);

  if (!options.ignoreErrors && result.status !== 0) {
    const detail = options.capture ? result.stderr || result.stdout : "";
    throw new Error(`${commandToRun} ${args.join(" ")} failed.${detail ? `\n${detail}` : ""}`);
  }

  return result;
}

function isLoaded(serviceLabel = label) {
  return run("launchctl", ["print", serviceTargetFor(serviceLabel)], {
    capture: true,
    ignoreErrors: true,
  }).status === 0;
}

async function removeLegacyLaunchAgents() {
  for (const legacyLabel of legacyLabels) {
    if (isLoaded(legacyLabel)) {
      run("launchctl", ["bootout", serviceTargetFor(legacyLabel)], { ignoreErrors: true });
    }

    await rm(plistPathFor(legacyLabel), { force: true });
  }
}

async function ensureRuntimeDirs() {
  await mkdir(reportsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(gatewayDir, { recursive: true });
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WatchPaths</key>
  <array>
    <string>${xmlEscape(reportsDir)}</string>
  </array>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
</dict>
</plist>
`;
}

async function install() {
  await ensureRuntimeDirs();
  await mkdir(launchAgentsDir, { recursive: true });
  await removeLegacyLaunchAgents();
  await writeFile(plistPath, plist(), "utf8");

  if (!sendExisting) {
    run(process.execPath, ["src/deliver-pending.mjs", "--mark-existing"]);
  }

  if (isLoaded()) {
    run("launchctl", ["bootout", serviceTarget], { ignoreErrors: true });
  }

  run("launchctl", ["bootstrap", domain, plistPath]);
  run("launchctl", ["kickstart", "-k", serviceTarget], { ignoreErrors: true });

  console.log(`Installed delivery gateway: ${label}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Log: ${logPath}`);
  console.log("Trigger: reports directory changes, plus one run at load.");
}

async function uninstall() {
  if (isLoaded()) {
    run("launchctl", ["bootout", serviceTarget], { ignoreErrors: true });
  }

  await rm(plistPath, { force: true });
  await removeLegacyLaunchAgents();
  console.log(`Uninstalled delivery gateway: ${label}`);
}

function start() {
  if (!isLoaded()) {
    run("launchctl", ["bootstrap", domain, plistPath]);
  }

  run("launchctl", ["kickstart", "-k", serviceTarget]);
  console.log(`Started delivery gateway: ${label}`);
}

function stop() {
  if (!isLoaded()) {
    console.log(`Delivery gateway is already stopped: ${label}`);
    return;
  }

  run("launchctl", ["bootout", serviceTarget]);
  console.log(`Stopped delivery gateway: ${label}`);
}

function status() {
  const installed = spawnSync("test", ["-f", plistPath]).status === 0;
  const loaded = isLoaded();

  console.log(`Service: ${label}`);
  console.log(`Installed: ${installed ? "yes" : "no"}`);
  console.log(`Loaded: ${loaded ? "yes" : "no"}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Log: ${logPath}`);

  if (loaded) {
    const result = run("launchctl", ["print", serviceTarget], {
      capture: true,
      ignoreErrors: true,
    });
    const lines = result.stdout
      .split("\n")
      .filter((line) =>
        /state =|runs =|last exit code =|WatchPaths|path =|job state =/.test(line),
      );

    for (const line of lines) console.log(line);
  }
}

function logs() {
  run("tail", ["-n", "120", logPath], { ignoreErrors: true });
}

function runPending() {
  run(process.execPath, ["src/deliver-pending.mjs"]);
}

function markDelivered() {
  run(process.execPath, ["src/deliver-pending.mjs", "--mark-existing"]);
}

async function readDiscordRoutes() {
  return JSON.parse(await readFile(discordRoutesPath, "utf8"));
}

function discordWebhookLooksValid(webhook) {
  try {
    const url = new URL(webhook);
    return (
      url.protocol === "https:" &&
      /(^|\.)discord(app)?\.com$/.test(url.hostname) &&
      url.pathname.includes("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

function discordRouteChecks(discordRoutes) {
  const defaultWebhookEnv = discordRoutes.defaultWebhookEnv || "DISCORD_WEBHOOK_URL";
  const checks = [];
  const defaultWebhook = process.env[defaultWebhookEnv] || "";

  checks.push([
    "Default Discord webhook env",
    true,
    defaultWebhook ? `${defaultWebhookEnv} set` : `${defaultWebhookEnv} not set; used only for unmatched reports`,
  ]);

  if (defaultWebhook) {
    checks.push([
      "Default Discord webhook format",
      discordWebhookLooksValid(defaultWebhook),
      "checked without printing value",
    ]);
  }

  for (const route of discordRoutes.routes || []) {
    const primaryWebhook = process.env[route.webhookEnv] || "";
    const fallbackWebhook = route.fallbackWebhookEnv ? process.env[route.fallbackWebhookEnv] || "" : "";
    const activeEnv = primaryWebhook ? route.webhookEnv : fallbackWebhook ? route.fallbackWebhookEnv : null;
    const activeWebhook = primaryWebhook || fallbackWebhook;
    const requiredEnvs = [route.webhookEnv, route.fallbackWebhookEnv].filter(Boolean).join(" or ");

    checks.push([
      `Discord route ${route.name} env`,
      Boolean(activeEnv),
      activeEnv
        ? activeEnv === route.fallbackWebhookEnv
          ? `using fallback ${activeEnv}`
          : `using ${activeEnv}`
        : `missing ${requiredEnvs}`,
    ]);

    checks.push([
      `Discord route ${route.name} format`,
      Boolean(activeWebhook) && discordWebhookLooksValid(activeWebhook),
      activeWebhook ? "checked without printing value" : `missing ${requiredEnvs}`,
    ]);
  }

  return checks;
}

async function doctor() {
  const installed = spawnSync("test", ["-f", plistPath]).status === 0;
  const loaded = isLoaded();
  const discordRoutes = await readDiscordRoutes();

  const checks = [
    ["Node version", Number(process.versions.node.split(".")[0]) >= 22, process.versions.node],
    ["Repository root", repoRoot.endsWith("feedspot"), repoRoot],
    ["Discord routes config", true, discordRoutesPath],
    ...discordRouteChecks(discordRoutes),
    ["Reports directory", await pathExists(reportsDir), reportsDir],
    ["Logs directory", await pathExists(logsDir), logsDir],
    ["Gateway state directory", await pathExists(gatewayDir), gatewayDir],
    ["LaunchAgent plist", installed, plistPath],
    ["LaunchAgent loaded", loaded, serviceTarget],
  ];

  let failures = 0;

  for (const [labelText, ok, detail] of checks) {
    if (!ok) failures += 1;
    console.log(`${ok ? "OK" : "FAIL"}\t${labelText}\t${detail}`);
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function help() {
  console.log(`Usage: npm run gateway:<command>

Commands:
  gateway:install           Install or update the macOS LaunchAgent
  gateway:uninstall         Stop and remove the LaunchAgent plist
  gateway:start             Load and run the service
  gateway:stop              Unload the service but keep the plist
  gateway:restart           Stop, start, and run the service
  gateway:status            Show install/load/run status
  gateway:logs              Tail the delivery log
  gateway:run               Send pending reports once in the foreground
  gateway:mark-delivered    Mark existing reports as already delivered
  gateway:doctor            Run local configuration and service checks

Options:
  --send-existing           With install, send existing reports instead of marking them delivered
`);
}

switch (commandName) {
  case "install":
    await install();
    break;
  case "uninstall":
    await uninstall();
    break;
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "restart":
    stop();
    start();
    break;
  case "status":
    status();
    break;
  case "logs":
    logs();
    break;
  case "run":
    runPending();
    break;
  case "mark-delivered":
    markDelivered();
    break;
  case "doctor":
    await doctor();
    break;
  case "help":
  default:
    help();
}
