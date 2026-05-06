import { readFile } from "node:fs/promises";

const sourcesPath = new URL("../config/sources.json", import.meta.url);
const sources = JSON.parse(await readFile(sourcesPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertUniqueUrls(items, label) {
  const urls = items.map((item) => item.url);
  const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);

  assert(
    duplicates.length === 0,
    `${label} contains duplicate URL(s): ${[...new Set(duplicates)].join(", ")}`,
  );
}

assert(Number.isInteger(sources.rssLookbackHours), "rssLookbackHours must be an integer.");
assert(sources.rssLookbackHours >= 24, "rssLookbackHours should cover at least 24 hours.");
assert(Number.isInteger(sources.maxCandidates), "maxCandidates must be an integer.");
assert(sources.maxCandidates >= 100, "maxCandidates should be high enough for dedupe/ranking.");

assert(Array.isArray(sources.rss), "rss must be an array.");
assert(sources.rss.length >= 20, "rss should include a broad source set.");
assertUniqueUrls(sources.rss, "rss");

assert(Array.isArray(sources.officialSites), "officialSites must be an array.");
assert(sources.officialSites.length >= 10, "officialSites should include primary verification targets.");
assertUniqueUrls(sources.officialSites, "officialSites");

assert(sources.webSearch?.enabled === true, "webSearch must be enabled.");
assert(
  Array.isArray(sources.webSearch.queries) && sources.webSearch.queries.length >= 10,
  "webSearch.queries should include broad topical searches.",
);
assert(
  Array.isArray(sources.webSearch.officialDomainQueries) &&
    sources.webSearch.officialDomainQueries.length >= 10,
  "webSearch.officialDomainQueries should include primary-source searches.",
);

assert(sources.githubSearch?.enabled === true, "githubSearch must be enabled.");
assert(
  Array.isArray(sources.githubSearch.languages) && sources.githubSearch.languages.includes("TypeScript"),
  "githubSearch.languages must include TypeScript.",
);
assert(
  Array.isArray(sources.githubSearch.queries) && sources.githubSearch.queries.length >= 6,
  "githubSearch.queries should include reusable discovery queries.",
);

console.log("Source configuration looks usable.");
