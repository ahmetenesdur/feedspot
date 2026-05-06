import { createHash } from "node:crypto";
import { open, readdir, readFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const reportsDir = "reports";
const gatewayDir = ".gateway";
const tempDir = path.join(gatewayDir, "tmp");
const statePath = path.join(gatewayDir, "discord-delivered.json");
const legacyStatePath = path.join(reportsDir, ".discord-delivered.json");
const lockPath = path.join(gatewayDir, "delivery.lock");
const sendScript = "src/post-to-discord.mjs";
const lockTtlMs = 15 * 60 * 1000;
const markExisting = process.argv.includes("--mark-existing");

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readState() {
  const readableStatePath = (await fileExists(statePath))
    ? statePath
    : (await fileExists(legacyStatePath))
      ? legacyStatePath
      : null;

  if (!readableStatePath) {
    return {
      version: 1,
      reports: {},
    };
  }

  const raw = await readFile(readableStatePath, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed.version && parsed.reports) return parsed;

  return {
    version: 1,
    reports: Object.fromEntries(
      Object.entries(parsed).map(([reportPath, hash]) => [
        reportPath,
        {
          hash,
          status: "delivered",
          attempts: 0,
          chunks: null,
          messages: [],
          sentAt: null,
          lastAttemptAt: null,
          lastError: null,
        },
      ]),
    ),
  };
}

async function writeState(state) {
  await mkdir(gatewayDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  const tempPath = path.join(tempDir, `.discord-delivered.${process.pid}.${Date.now()}.tmp`);
  let handle;

  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(tempPath, statePath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }

    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function listReports() {
  await mkdir(reportsDir, { recursive: true });

  const entries = await readdir(reportsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => path.join(reportsDir, entry.name))
    .sort();
}

async function hashFile(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function removeStaleLock() {
  try {
    const lockStat = await stat(lockPath);
    const ageMs = Date.now() - lockStat.mtimeMs;

    if (ageMs > lockTtlMs) {
      await rm(lockPath, { force: true });
      return true;
    }
  } catch {}

  return false;
}

async function acquireLock() {
  await mkdir(gatewayDir, { recursive: true });

  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await handle.close();
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    if (await removeStaleLock()) {
      return acquireLock();
    }

    console.log("Delivery already running; exiting.");
    return false;
  }
}

async function releaseLock() {
  await rm(lockPath, { force: true }).catch(() => {});
}

function sendReport(reportPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [sendScript, "--json", reportPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `Discord delivery failed for ${reportPath} with exit code ${code}.`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Could not parse Discord delivery result for ${reportPath}.`, { cause: error }));
      }
    });
  });
}

function deliveredEntry(hash, previousEntry, result) {
  const previousAttempts = Number(previousEntry?.attempts || 0);

  return {
    hash,
    status: "delivered",
    attempts: previousAttempts + 1,
    chunks: result.chunks,
    messages: result.messages || [],
    sentAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
  };
}

function failedEntry(hash, previousEntry, error) {
  const previousAttempts = Number(previousEntry?.attempts || 0);

  return {
    hash,
    status: "failed",
    attempts: previousAttempts + 1,
    chunks: previousEntry?.chunks ?? null,
    messages: previousEntry?.messages || [],
    sentAt: previousEntry?.sentAt || null,
    lastAttemptAt: new Date().toISOString(),
    lastError: error.message,
  };
}

const locked = await acquireLock();

if (!locked) process.exit(0);

try {
  const state = await readState();
  const reports = await listReports();

  if (markExisting) {
    for (const reportPath of reports) {
      const hash = await hashFile(reportPath);
      const previousEntry = state.reports[reportPath];

      state.reports[reportPath] = {
        hash,
        status: "delivered",
        attempts: previousEntry?.attempts || 0,
        chunks: previousEntry?.chunks ?? null,
        messages: previousEntry?.messages || [],
        sentAt: previousEntry?.sentAt || null,
        lastAttemptAt: previousEntry?.lastAttemptAt || null,
        lastError: null,
        markedDeliveredAt: new Date().toISOString(),
      };
    }

    await writeState(state);
    console.log(`Marked ${reports.length} existing report(s) as already delivered.`);
  } else {
    let delivered = 0;
    let failed = 0;

    for (const reportPath of reports) {
      const hash = await hashFile(reportPath);
      const previousEntry = state.reports[reportPath];

      if (previousEntry?.hash === hash && previousEntry.status === "delivered") continue;

      try {
        const result = await sendReport(reportPath);
        state.reports[reportPath] = deliveredEntry(hash, previousEntry, result);
        delivered += 1;
        await writeState(state);
        console.log(`Delivered ${reportPath} in ${result.chunks} chunk(s).`);
      } catch (error) {
        state.reports[reportPath] = failedEntry(hash, previousEntry, error);
        failed += 1;
        await writeState(state);
        console.error(`Failed to deliver ${reportPath}: ${error.message}`);
      }
    }

    if (failed > 0) {
      throw new Error(`Delivery failed for ${failed} report(s).`);
    }

    if (delivered === 0) {
      console.log("No pending Discord reports.");
    } else {
      console.log(`Delivered ${delivered} pending report(s).`);
    }
  }
} finally {
  await releaseLock();
}
