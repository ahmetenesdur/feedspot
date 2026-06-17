import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const writeReportScript = fileURLToPath(new URL("../src/write-report.mjs", import.meta.url));

async function withTempWorkspace(callback) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "feedspot-write-report-"));

  try {
    await callback(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function writeReport(workspace, content) {
  return spawnSync(
    process.execPath,
    [writeReportScript, "reports/2099-01-01-markets-digest.md"],
    {
      cwd: workspace,
      input: content,
      encoding: "utf8",
    },
  );
}

test("rejects repeated ASCII transliterations in Turkish prose", async () => {
  await withTempWorkspace(async (workspace) => {
    const result = writeReport(
      workspace,
      "# Piyasa\n\nBu bulten haber ve piyasa baglami icindir; yatirim tavsiyesi degildir.\n",
    );
    const reportPath = path.join(workspace, "reports/2099-01-01-markets-digest.md");

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /native Turkish Unicode characters/i);
    await assert.rejects(access(reportPath), { code: "ENOENT" });
  });
});

test("preserves native Turkish UTF-8 prose", async () => {
  await withTempWorkspace(async (workspace) => {
    const content = "# Piyasa\n\nBu bülten haber ve piyasa bağlamı içindir; yatırım tavsiyesi değildir.\n";
    const result = writeReport(workspace, content);
    const reportPath = path.join(workspace, "reports/2099-01-01-markets-digest.md");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(reportPath, "utf8"), content);
  });
});
