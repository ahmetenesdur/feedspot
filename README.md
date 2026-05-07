# Feedspot

Feedspot is a small helper repository for Codex Automation powered Turkish news digests.

Codex Automation owns the AI/editorial work: research, source review, deduplication, ranking, synthesis, and Turkish writing. This repository owns the operational pieces around that workflow: source configuration, report storage conventions, and Discord delivery.

## Architecture

The system is intentionally split into two responsibilities:

1. **Codex Automation creates the report.**
   - Runs daily.
   - Reads one of the source brief files under `config/`.
   - Uses available tools and MCPs to collect and verify recent news for that digest.
   - Writes a Turkish Markdown report to `reports/YYYY-MM-DD-<digest-name>.md`.

2. **The local delivery gateway sends the report.**
   - Runs as a macOS LaunchAgent.
   - Watches the `reports/` directory for changes.
   - Sends new or changed Markdown reports to Discord.
   - Tracks structured delivery state in `.gateway/discord-delivered.json`.

This split exists because unattended Codex Automation runs may not have outbound shell network access to Discord. The delivery gateway runs in the normal macOS user session, outside the Codex sandbox.

No Discord bot, server, GitHub Actions workflow, or model API client is required in this repo.

## Environment

Required in local `.env` or the delivery gateway environment:

```bash
DISCORD_WEBHOOK_URL=your_existing_or_default_discord_webhook_url
DISCORD_GAMING_WEBHOOK_URL=your_gaming_discord_webhook_url
```

Optional, if the Tech/AI digest should also use an explicit route-specific webhook instead of the default webhook:

```bash
DISCORD_TECH_AI_WEBHOOK_URL=your_tech_ai_discord_webhook_url
```

Optional for Codex/tooling workflows:

```bash
GITHUB_TOKEN=your_github_token
```

Optional Discord delivery behavior:

```bash
DISCORD_SUPPRESS_EMBEDS=0
```

Link previews are suppressed by default. Set `DISCORD_SUPPRESS_EMBEDS=0` only if Discord should expand source URLs into preview cards.

Discord webhook URLs are never printed or logged.

## Local Setup

Install dependencies:

```bash
npm ci
```

Run checks:

```bash
npm run check
```

## Atomic Report Writes

Reports should not be written directly to their final path. A partial write can trigger delivery before the Markdown file is complete.

Preferred write pattern:

```bash
npm run write-report -- reports/YYYY-MM-DD-tech-ai-digest.md < /path/to/generated-report.md
npm run write-report -- reports/YYYY-MM-DD-gaming-digest.md < /path/to/generated-gaming-report.md
```

The helper writes to `.gateway/tmp/reports/`, fsyncs the temporary file, then renames it into `reports/`. The final rename is atomic on the same repository filesystem, so the gateway only sees complete Markdown reports.

Codex Automation should follow the same rule if it writes the file itself: write to a temporary file outside `reports/`, then rename to the final report path.

## Local Delivery Gateway

Install or update the macOS LaunchAgent:

```bash
npm run gateway:install
```

By default, installation marks existing reports as delivered to avoid posting historical duplicates. To post existing reports during installation:

```bash
npm run gateway:install -- --send-existing
```

Lifecycle commands:

```bash
npm run gateway:status
npm run gateway:start
npm run gateway:stop
npm run gateway:restart
npm run gateway:uninstall
```

Operational commands:

```bash
npm run gateway:run
npm run gateway:logs
npm run gateway:mark-delivered
npm run gateway:doctor
```

The gateway LaunchAgent is installed at:

```bash
~/Library/LaunchAgents/com.ahmetenesdur.feedspot.delivery.plist
```

The LaunchAgent uses:

- `RunAtLoad`: checks for pending reports when the service loads.
- `WatchPaths`: runs when `reports/` changes.
- `ThrottleInterval`: prevents rapid duplicate launches when multiple filesystem events arrive together.

It does not use a 60-second polling interval. Runtime state, locks, logs, and temporary report writes stay outside `reports/` so the gateway does not retrigger itself.

`delivery:*` scripts are kept as backward-compatible aliases, but `gateway:*` is the preferred command surface.

## Manual Discord Delivery

Send one report directly:

```bash
npm run send-discord -- reports/YYYY-MM-DD-tech-ai-digest.md
npm run send-discord -- reports/YYYY-MM-DD-gaming-digest.md
```

Send all unsent or changed reports once:

```bash
npm run deliver-pending
```

Preview how many Discord messages would be sent without touching the webhook:

```bash
npm run dry-run-discord -- reports/YYYY-MM-DD-tech-ai-digest.md
npm run dry-run-discord -- reports/YYYY-MM-DD-gaming-digest.md
```

## Discord Routing

Discord routing lives in `config/discord-routes.json`.

- `reports/*-tech-ai-digest.md` uses `DISCORD_TECH_AI_WEBHOOK_URL` when set, otherwise it falls back to `DISCORD_WEBHOOK_URL`.
- `reports/*-gaming-digest.md` uses `DISCORD_GAMING_WEBHOOK_URL`.
- Unmatched report names use `DISCORD_WEBHOOK_URL`.

The gateway remains a single LaunchAgent. It watches `reports/`, sends each Markdown report to the route selected by filename, and keeps one shared delivery state file.

## Digest Configurations

Sources and editorial constraints live in source brief files under `config/`:

- `config/sources.json`: Tech/AI/developer digest.
- `config/gaming-sources.json`: Gaming digest.

The automation should treat each file as a research brief, not as a complete crawler implementation:

- `rss` lists feeds to scan first.
- `officialSites` lists primary verification targets.
- `webSearch.queries` gives broad topical searches for fresh stories.
- `webSearch.officialDomainQueries` gives primary-source searches for high-signal vendors and standards/security bodies.
- `githubSearch`, when present, defines repository discovery preferences for new or newly active developer tooling.
- `trackedGames`, when present, defines user-selected games to check every gaming digest run.
- `editorialWorkflow` defines dedupe, ranking, and rejection rules.

The daily run should reject weak claims unless they can be traced to a primary source or at least two independent credible sources.

For `config/gaming-sources.json`, `trackedGames.games` can be edited directly to add or remove watched games. Set a game's `enabled` field to `false` to keep it in the config without including it in the daily editorial pass. Each enabled game should include aliases, platforms, official sources, and reusable search queries. The automation should add material verified updates to a `Takipteki Oyunlar` report section; if there is no meaningful update and `includeWhenNoMajorNews` is true, it should use one compact sentence rather than filler.

Recommended report paths:

```bash
reports/YYYY-MM-DD-tech-ai-digest.md
reports/YYYY-MM-DD-gaming-digest.md
```

The existing delivery gateway sends both reports because it watches all Markdown files in `reports/`.

## Output

Reports are generated as Markdown with this structure:

- Short TL;DR
- Most important developments
- Tracked games, when configured for the gaming digest
- Developer follow-ups
- Possible noise or hype
- A short action list

The digest language is Turkish, while technical terms remain in English when that is more natural.

For multi-message Discord delivery, the gateway splits long Markdown reports at safe text boundaries without adding visible part headers. Give each report a clear H1 such as `# Daily Tech/AI Digest` or `# Daily Gaming Digest`.

## Ignored Local State

These paths are intentionally not committed:

- `.env`
- `node_modules/`
- `reports/`
- `logs/`
- `.gateway/`

`.gateway/discord-delivered.json` is local state. It maps report paths to content hashes so the delivery gateway does not repost unchanged reports.

State entries include:

- content hash
- delivery status
- attempt count
- sent timestamp
- chunk count
- Discord message IDs returned by the webhook
- last error, if delivery failed

## Notes

- Discord messages are split around 1950 characters to stay under the 2000-character limit.
- Accidental mentions are disabled with `allowed_mentions: { parse: [] }`.
- Link previews are suppressed with Discord message flags.
- Discord webhook sends use `wait=true`, so accepted message IDs can be stored in delivery state.
- Delivery uses a lock file at `.gateway/delivery.lock` to prevent concurrent gateway runs.
- Delivery state is written atomically to reduce the chance of a partial `discord-delivered.json`.
- Discord `429` rate limits are retried before the run fails.
- Network failures are reported without printing the webhook URL.
- `npm run check-feeds` touches public source URLs and may fail in a sandbox without outbound network access.
