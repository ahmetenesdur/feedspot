import { readFile } from "node:fs/promises";

const sourcesPath = new URL("../config/sources.json", import.meta.url);
const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
const userAgent = "tech-ai-aggregate-feed-check/1.0";

let failures = 0;

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
      console.log(`BAD\t${response.status}\t${source.name}\t${source.url}\t${contentType}`);
      continue;
    }

    console.log(`OK\t${response.status}\t${source.name}\t${source.url}`);
  } catch (error) {
    failures += 1;
    console.log(`ERR\t${error.cause?.code || error.name}\t${source.name}\t${source.url}`);
  }
}

if (failures > 0) {
  throw new Error(`${failures} feed check(s) failed.`);
}
