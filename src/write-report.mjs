import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

const reportsDir = "reports";
const tempDir = path.join(".gateway", "tmp", "reports");
const targetPath = process.argv[2];

if (!targetPath) {
  throw new Error("Usage: npm run write-report -- reports/YYYY-MM-DD-digest-name.md");
}

const normalizedTarget = path.normalize(targetPath);

if (!normalizedTarget.startsWith(`${reportsDir}${path.sep}`) || !normalizedTarget.endsWith(".md")) {
  throw new Error("Report path must be a Markdown file under reports/.");
}

const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

if (content.toString("utf8").trim().length === 0) {
  throw new Error("Refusing to write an empty report.");
}

await mkdir(path.dirname(normalizedTarget), { recursive: true });
await mkdir(tempDir, { recursive: true });

const tempPath = path.join(
  tempDir,
  `${path.basename(normalizedTarget)}.${process.pid}.${Date.now()}.tmp`,
);

let fileHandle;

try {
  fileHandle = await open(tempPath, "wx");
  await fileHandle.writeFile(content);
  await fileHandle.sync();
  await fileHandle.close();
  fileHandle = null;

  await rename(tempPath, normalizedTarget);
  console.log(`Report written atomically to ${normalizedTarget}.`);
} catch (error) {
  if (fileHandle) {
    await fileHandle.close().catch(() => {});
  }

  await rm(tempPath, { force: true }).catch(() => {});
  throw error;
}
