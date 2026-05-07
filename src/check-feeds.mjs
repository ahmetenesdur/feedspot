import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const configDir = new URL("../config/", import.meta.url);
const requestedConfigs = process.argv.slice(2);
const userAgent = "feedspot-feed-check/1.0";

let failures = 0;

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

for (const target of await configTargets()) {
  const sources = JSON.parse(await readFile(target.url, "utf8"));

  for (const source of sources.rss) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "user-agent": userAgent,
        },
      });
      const contentType = response.headers.get("content-type") || "";
      const feedLike = /rss|atom|xml/i.test(contentType);

      if (!response.ok || !feedLike) {
        failures += 1;
        console.log(`BAD\t${target.label}\t${response.status}\t${source.name}\t${source.url}\t${contentType}`);
        continue;
      }

      console.log(`OK\t${target.label}\t${response.status}\t${source.name}\t${source.url}`);
    } catch (error) {
      failures += 1;
      console.log(`ERR\t${target.label}\t${error.cause?.code || error.name}\t${source.name}\t${source.url}`);
    }
  }
}

if (failures > 0) {
  throw new Error(`${failures} feed check(s) failed.`);
}
