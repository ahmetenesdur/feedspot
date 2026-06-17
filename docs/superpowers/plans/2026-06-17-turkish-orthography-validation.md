# Turkish Orthography Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent future digest reports with repeated ASCII Turkish transliterations from reaching the reports directory and Discord.

**Architecture:** Keep generation guidance in the automation prompt and enforce the output contract at the existing atomic write boundary. The writer rejects clearly suspicious prose with a focused word matcher and never mutates generated content.

**Tech Stack:** Node.js 22+, built-in Node test runner, TOML automation configuration.

---

### Task 1: Add the regression test

**Files:**
- Create: `test/write-report.test.mjs`

- [ ] **Step 1: Write an integration test that rejects repeated ASCII Turkish transliterations**

Create a temporary working directory, invoke `src/write-report.mjs` with `Bu bulten haber ve piyasa baglami icindir; yatirim tavsiyesi degildir.`, and assert that the process fails with a native-Turkish-character error and does not create the final report.

- [ ] **Step 2: Write a positive integration test for native Turkish prose**

Invoke the same helper with `Bu bülten haber ve piyasa bağlamı içindir; yatırım tavsiyesi değildir.` and assert that the process exits successfully and preserves the exact UTF-8 text.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test test/write-report.test.mjs`

Expected: the rejection test fails because the current helper accepts ASCII Turkish prose.

### Task 2: Enforce the report contract

**Files:**
- Modify: `src/write-report.mjs`
- Test: `test/write-report.test.mjs`

- [ ] **Step 1: Add focused ASCII Turkish detection**

Match complete, case-insensitive forms of `bulten`, `baglam`, `yatirim`, `degil`, `bugun`, and `Turkiye`, including the common suffix forms present in faulty reports.

- [ ] **Step 2: Reject only clearly suspicious content**

Before creating report directories, throw a clear regeneration error when at least three suspicious words are found. Keep valid content byte-for-byte unchanged.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run: `node --test test/write-report.test.mjs`

Expected: both rejection and native UTF-8 tests pass.

### Task 3: Clarify automation generation guidance

**Files:**
- Modify: `/Users/ahmetenesdur/.codex/automations/daily-global-markets-digest/automation.toml`

- [ ] **Step 1: Add explicit orthography guidance**

Extend the prompt with: `Use native Turkish Unicode characters throughout Turkish prose (ç, ğ, ı, İ, ö, ş, ü); never transliterate Turkish words to ASCII forms such as bulten, baglam, yatirim, degil, or Turkiye.`

- [ ] **Step 2: Confirm the active automation contains the guidance**

Run: `rg -n "native Turkish Unicode|never transliterate" /Users/ahmetenesdur/.codex/automations/daily-global-markets-digest/automation.toml`

Expected: both requirements appear in the active prompt.

### Task 4: Verify the complete change

**Files:**
- Verify: `src/write-report.mjs`
- Verify: `test/write-report.test.mjs`
- Verify: `/Users/ahmetenesdur/.codex/automations/daily-global-markets-digest/automation.toml`

- [ ] **Step 1: Run all repository checks**

Run: `npm run check`

Expected: syntax checks, configuration checks, and all tests pass with zero failures.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check && git status --short && git diff -- src/write-report.mjs test/write-report.test.mjs`

Expected: no whitespace errors; only the intended implementation and test changes are present in the repository worktree. The external automation configuration is verified separately.
