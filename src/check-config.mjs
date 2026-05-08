import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const configDir = new URL("../config/", import.meta.url);
const discordRoutesPath = new URL("discord-routes.json", configDir);
const requestedConfigs = process.argv.slice(2);

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

function isDiscordWebhookEnvName(value) {
  return typeof value === "string" && /^DISCORD(?:_[A-Z0-9]+)*_WEBHOOK_URL$/.test(value);
}

function assertNamedUrls(items, label) {
  for (const [index, item] of items.entries()) {
    assert(typeof item.name === "string" && item.name.trim(), `${label}[${index}].name is required.`);
    assert(typeof item.url === "string" && item.url.startsWith("https://"), `${label}[${index}].url must be HTTPS.`);
  }
}

function assertReportPathTemplate(value, label) {
  assert(typeof value === "string" && value.trim(), `${label} is required.`);
  assert(value.startsWith("reports/"), `${label} must be under reports/.`);
  assert(value.includes("YYYY-MM-DD"), `${label} must include YYYY-MM-DD.`);
  assert(value.endsWith(".md"), `${label} must target a Markdown file.`);
}

function validateCadence(cadence, label) {
  if (!cadence) return;

  assert(cadence.primary || cadence.watch, `${label}: cadence must include primary or watch.`);

  if (cadence.primary) {
    assert(typeof cadence.primary.name === "string" && cadence.primary.name.trim(), `${label}: cadence.primary.name is required.`);
    assert(cadence.primary.schedule === "weekly", `${label}: cadence.primary.schedule must be weekly.`);
    assert(typeof cadence.primary.recommendedDay === "string" && cadence.primary.recommendedDay.trim(), `${label}: cadence.primary.recommendedDay is required.`);
    assert(Number.isInteger(cadence.primary.lookbackHours), `${label}: cadence.primary.lookbackHours must be an integer.`);
    assert(cadence.primary.lookbackHours >= 120, `${label}: cadence.primary.lookbackHours should cover most of a week.`);
    assertReportPathTemplate(cadence.primary.reportPathTemplate, `${label}: cadence.primary.reportPathTemplate`);
    assert(
      cadence.primary.postWhenNoMajorNews === true || cadence.primary.postWhenNoMajorNews === false,
      `${label}: cadence.primary.postWhenNoMajorNews must be boolean.`,
    );
    assert(Array.isArray(cadence.primary.guidance) && cadence.primary.guidance.length >= 2, `${label}: cadence.primary.guidance should include editorial rules.`);
  }

  if (cadence.watch) {
    assert(typeof cadence.watch.name === "string" && cadence.watch.name.trim(), `${label}: cadence.watch.name is required.`);
    assert(cadence.watch.schedule === "daily", `${label}: cadence.watch.schedule must be daily.`);
    assert(Number.isInteger(cadence.watch.lookbackHours), `${label}: cadence.watch.lookbackHours must be an integer.`);
    assert(cadence.watch.lookbackHours >= 24, `${label}: cadence.watch.lookbackHours should cover at least 24 hours.`);
    assertReportPathTemplate(cadence.watch.reportPathTemplate, `${label}: cadence.watch.reportPathTemplate`);
    assert(
      cadence.watch.postOnlyIfMaterial === true || cadence.watch.postOnlyIfMaterial === false,
      `${label}: cadence.watch.postOnlyIfMaterial must be boolean.`,
    );
    assert(
      cadence.watch.skipReportWhenNoMaterialUpdates === true || cadence.watch.skipReportWhenNoMaterialUpdates === false,
      `${label}: cadence.watch.skipReportWhenNoMaterialUpdates must be boolean.`,
    );
    assert(Array.isArray(cadence.watch.triggerIf) && cadence.watch.triggerIf.length >= 3, `${label}: cadence.watch.triggerIf should include trigger rules.`);
    assert(Array.isArray(cadence.watch.rejectIfOnly) && cadence.watch.rejectIfOnly.length >= 2, `${label}: cadence.watch.rejectIfOnly should include rejection rules.`);
  }
}

function validateTrackedGames(trackedGames, label) {
  if (!trackedGames) return;

  assert(trackedGames.enabled === true || trackedGames.enabled === false, `${label}: trackedGames.enabled must be boolean.`);
  assert(
    typeof trackedGames.reportSectionTitle === "string" && trackedGames.reportSectionTitle.trim(),
    `${label}: trackedGames.reportSectionTitle is required.`,
  );
  assert(Number.isInteger(trackedGames.lookbackHours), `${label}: trackedGames.lookbackHours must be an integer.`);
  assert(trackedGames.lookbackHours >= 24, `${label}: trackedGames.lookbackHours should cover at least 24 hours.`);
  assert(
    trackedGames.includeWhenNoMajorNews === true || trackedGames.includeWhenNoMajorNews === false,
    `${label}: trackedGames.includeWhenNoMajorNews must be boolean.`,
  );
  assert(Array.isArray(trackedGames.guidance) && trackedGames.guidance.length >= 3, `${label}: trackedGames.guidance should include editorial rules.`);
  assert(Array.isArray(trackedGames.games), `${label}: trackedGames.games must be an array.`);

  const names = new Set();

  for (const [index, game] of trackedGames.games.entries()) {
    const gameLabel = `${label}: trackedGames.games[${index}]`;

    assert(typeof game.name === "string" && game.name.trim(), `${gameLabel}.name is required.`);
    assert(!names.has(game.name), `${label}: duplicate tracked game name ${game.name}.`);
    names.add(game.name);

    assert(game.enabled === true || game.enabled === false, `${gameLabel}.enabled must be boolean.`);
    assert(Array.isArray(game.aliases) && game.aliases.length >= 1, `${gameLabel}.aliases should include at least one alias.`);
    assert(Array.isArray(game.platforms) && game.platforms.length >= 1, `${gameLabel}.platforms should include at least one platform.`);
    assert(Array.isArray(game.officialSources) && game.officialSources.length >= 1, `${gameLabel}.officialSources should include at least one primary source.`);
    assertNamedUrls(game.officialSources, `${gameLabel}.officialSources`);
    assertUniqueUrls(game.officialSources, `${gameLabel}.officialSources`);
    assert(Array.isArray(game.searchQueries) && game.searchQueries.length >= 2, `${gameLabel}.searchQueries should include reusable queries.`);
  }
}

function validateSources(sources, label) {
  if (sources.digest) {
    assertReportPathTemplate(sources.digest.reportPathTemplate, `${label}: digest.reportPathTemplate`);
  }

  assert(Number.isInteger(sources.rssLookbackHours), `${label}: rssLookbackHours must be an integer.`);
  assert(sources.rssLookbackHours >= 24, `${label}: rssLookbackHours should cover at least 24 hours.`);
  assert(Number.isInteger(sources.maxCandidates), `${label}: maxCandidates must be an integer.`);
  assert(sources.maxCandidates >= 100, `${label}: maxCandidates should be high enough for dedupe/ranking.`);

  assert(Array.isArray(sources.audience), `${label}: audience must be an array.`);
  assert(sources.audience.length >= 2, `${label}: audience should describe the intended readers.`);

  validateCadence(sources.cadence, label);
  validateTrackedGames(sources.trackedGames, label);

  assert(sources.editorialWorkflow, `${label}: editorialWorkflow is required.`);
  assert(
    Number.isInteger(sources.editorialWorkflow.minimumIndependentSourcesForNonPrimaryClaims),
    `${label}: editorialWorkflow.minimumIndependentSourcesForNonPrimaryClaims must be an integer.`,
  );
  assert(
    Array.isArray(sources.editorialWorkflow.dedupeBy) && sources.editorialWorkflow.dedupeBy.length >= 3,
    `${label}: editorialWorkflow.dedupeBy should include reusable dedupe keys.`,
  );
  assert(
    Array.isArray(sources.editorialWorkflow.rankBy) && sources.editorialWorkflow.rankBy.length >= 5,
    `${label}: editorialWorkflow.rankBy should include ranking rules.`,
  );
  assert(
    Array.isArray(sources.editorialWorkflow.rejectIf) && sources.editorialWorkflow.rejectIf.length >= 5,
    `${label}: editorialWorkflow.rejectIf should include rejection rules.`,
  );

  assert(Array.isArray(sources.rss), `${label}: rss must be an array.`);
  assert(sources.rss.length >= 10, `${label}: rss should include a broad source set.`);
  assertNamedUrls(sources.rss, `${label}: rss`);
  assertUniqueUrls(sources.rss, `${label}: rss`);

  assert(Array.isArray(sources.officialSites), `${label}: officialSites must be an array.`);
  assert(sources.officialSites.length >= 5, `${label}: officialSites should include primary verification targets.`);
  assertNamedUrls(sources.officialSites, `${label}: officialSites`);
  assertUniqueUrls(sources.officialSites, `${label}: officialSites`);

  assert(sources.webSearch?.enabled === true, `${label}: webSearch must be enabled.`);
  assert(
    Array.isArray(sources.webSearch.queries) && sources.webSearch.queries.length >= 6,
    `${label}: webSearch.queries should include broad topical searches.`,
  );
  assert(
    Array.isArray(sources.webSearch.officialDomainQueries) &&
      sources.webSearch.officialDomainQueries.length >= 5,
    `${label}: webSearch.officialDomainQueries should include primary-source searches.`,
  );

  if (sources.githubSearch) {
    assert(sources.githubSearch.enabled === true, `${label}: githubSearch.enabled must be true when present.`);
    assert(
      Array.isArray(sources.githubSearch.queries) && sources.githubSearch.queries.length >= 6,
      `${label}: githubSearch.queries should include reusable discovery queries.`,
    );
  }
}

function validateDiscordRoutes(discordRoutes, label) {
  assert(
    typeof discordRoutes.defaultWebhookEnv === "string" && discordRoutes.defaultWebhookEnv.trim(),
    `${label}: defaultWebhookEnv is required.`,
  );
  assert(
    isDiscordWebhookEnvName(discordRoutes.defaultWebhookEnv),
    `${label}: defaultWebhookEnv should name a Discord webhook environment variable.`,
  );
  assert(Array.isArray(discordRoutes.routes), `${label}: routes must be an array.`);
  assert(discordRoutes.routes.length >= 2, `${label}: routes should include the known digest destinations.`);

  const names = new Set();
  const matches = new Set();

  for (const [index, route] of discordRoutes.routes.entries()) {
    assert(typeof route.name === "string" && route.name.trim(), `${label}: routes[${index}].name is required.`);
    assert(!names.has(route.name), `${label}: duplicate route name ${route.name}.`);
    names.add(route.name);

    assert(typeof route.match === "string" && route.match.endsWith(".md"), `${label}: routes[${index}].match must target Markdown reports.`);
    assert(!matches.has(route.match), `${label}: duplicate route match ${route.match}.`);
    matches.add(route.match);

    assert(
      isDiscordWebhookEnvName(route.webhookEnv),
      `${label}: routes[${index}].webhookEnv should name a Discord webhook environment variable.`,
    );

    if (route.fallbackWebhookEnv) {
      assert(
        isDiscordWebhookEnvName(route.fallbackWebhookEnv),
        `${label}: routes[${index}].fallbackWebhookEnv should name a Discord webhook environment variable.`,
      );
    }
  }
}

async function configTargets() {
  if (requestedConfigs.length > 0) {
    return requestedConfigs.map((configPath) => ({
      label: configPath,
      url: pathToFileURL(path.resolve(configPath)),
    }));
  }

  const entries = await readdir(configDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("sources.json"))
    .map((entry) => ({
      label: `config/${entry.name}`,
      url: new URL(entry.name, configDir),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const targets = await configTargets();

assert(targets.length > 0, "No source configuration files found.");

validateDiscordRoutes(JSON.parse(await readFile(discordRoutesPath, "utf8")), "config/discord-routes.json");
console.log("config/discord-routes.json: Discord routing configuration looks usable.");

for (const target of targets) {
  const sources = JSON.parse(await readFile(target.url, "utf8"));
  validateSources(sources, target.label);
  console.log(`${target.label}: source configuration looks usable.`);
}
