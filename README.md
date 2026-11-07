# Lichii compatibility website

A standalone Switch 2 community report site. All application files live at the repository root.

Imported from `zortos293/Eglantine` commit `7ab95d7028291da9b1cda3d3793d69dea1b718b4`, taking only the contents of `website/` without emulator files or history. To verify the import against a checkout of that source, run `node scripts/verify-migration.mjs /path/to/Eglantine/website`. Only this README changes from the source snapshot; the verification script is new.

The launch follows the [dark Paper design](https://app.paper.design/file/01M6GQ17RX2F3XN1N9H2Z01KMA/p-2-0), using Paper's typography: Inter Tight for text and JetBrains Mono for numbers and labels. Both are self-hosted from the `@fontsource/inter-tight` and `@fontsource/jetbrains-mono` packages under the SIL Open Font License 1.1, included at `public/fonts/OFL.txt`. Vite emits every font as its own file (`assetsInlineLimit: 0`), because the CSP allows fonts only from `'self'`. The database starts with **565 catalog entries and zero reports**. Every title is untested until a real report is submitted. There are no generated players, statistics, performance figures or log files.

## Run locally

Requires Node.js 24 and PostgreSQL 16 or later.

1. Run `npm ci` in the repository root.
2. Copy `.env.example` to `.env`. Set the database URL and generate two different secrets with `openssl rand -hex 32`.
3. Keep `APP_ORIGIN=http://localhost:3000` and `TRUST_PROXY=false` for local use.
4. Run `npm run build`, then `npm start`.

The server binds `0.0.0.0` and reads `PORT`, defaulting to 3000. Startup runs migrations, imports the checked-in catalog and removes expired private data. `npm run dev` watches server changes; rebuild the frontend and restart the server after changing frontend files. `.env` is loaded by the start and dev commands and is excluded from git and Docker.

Migrations and imports share a PostgreSQL transaction advisory lock. They are safe to run concurrently and on every restart. Imports upsert catalog metadata by SteamGridDB ID and never create, replace or delete reports. `npm run db:prepare` runs the same preparation separately. It does not require the HTTP server.

## Deploy on Railway

- Use `/` as the service root and the repository root as the Docker build context. `Dockerfile` builds the frontend and runs the server as the non-root `node` user.
- Attach PostgreSQL and set `DATABASE_URL` to its private connection string. Keep database traffic on the private network. Use a verified TLS configuration if connecting over a public database endpoint; the app never disables certificate verification.
- Set `APP_ORIGIN` to the exact HTTPS origin without a trailing slash. The production origin is `https://lichii.zortos.me`.
- Set `COOKIE_SECRET` and `RATE_LIMIT_SECRET` to separate random values of at least 32 characters.
- Set `NODE_ENV=production` and `TRUST_PROXY=true` only behind Railway’s edge.
- Optionally set `MAINTAINER_API_TOKEN_SHA256` to enable token access to the maintainer API. See [Maintainer API token and MCP server](#maintainer-api-token-and-mcp-server).
- Use `/api/health` as the health check. It queries PostgreSQL and returns 503 if the database is unavailable.
- No volume is needed for this app. Reports, private log bytes, sessions, rate limits and audits are all in PostgreSQL.
- No separate predeploy command is needed. Startup prepares the database under a lock before accepting traffic. Configure database backups separately according to the operator’s retention policy.

Configure the service in Railway’s dashboard or API with root directory `/`, Dockerfile auto-detection, health check `/api/health`, a 120-second health-check timeout, and restart policy `ON_FAILURE` with five retries. Disable app sleeping. New Railway services no longer accept `railway.json` config-as-code. A CLI source upload should upload this repository's root.

### GitHub OAuth

Create a GitHub OAuth App with the callback:

```text
https://lichii.zortos.me/api/auth/callback
```

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ALLOWED_ID=65777760` and `GITHUB_ALLOWED_LOGIN=zortos293`. The login is deliberately restricted to this account. The immutable numeric ID and current login must both match the identity returned by GitHub’s authenticated `/user` endpoint. Never substitute the username for the ID check.

Set this callback in the GitHub OAuth App as well. The website domain alone does not update that setting. For a separate deployment, use its exact origin with `/api/auth/callback`.

Missing OAuth configuration disables maintainer access rather than bypassing authentication. The public site remains usable. Real OAuth testing requires the configured callback origin and the account owner’s browser. Local tests verify the flow’s state, PKCE, cookie and allowlist logic without using production credentials.

The application uses `oauth4webapi` for authorization response validation and the PKCE-protected code exchange. OAuth attempts are signed, browser-bound and single-use, with a ten-minute expiry. Session tokens are cryptographically random, stored hashed in PostgreSQL, expire after eight hours, and use Secure/HttpOnly/SameSite=Lax cookies in production. Every private route independently checks the current configured allowlist. OAuth access tokens are not stored or returned to the browser. Redirect destinations are fixed.

### Trusted proxy boundary

Fastify does not trust `X-Forwarded-For`. In Railway mode, rate limits use only the single `X-Real-IP` address overwritten by Railway’s edge, validated with Node’s IP parser. Missing or invalid values fail closed for API requests, except the health check. Local mode ignores all forwarded headers and uses the connection address.

Only Railway’s edge and trusted services in the private project may reach the app in this mode. Do not expose its container port directly or put an untrusted private-network service beside it. Such a caller could set `X-Real-IP`; this is a deployment trust boundary, not a portable proxy setting. Reverify the edge behavior before moving to another hosting provider. Railway’s guidance: [trusted proxy configuration](https://station.railway.com/questions/engineering-confirmation-secure-proxy-t-d05079b3).

## Desktop reporting API

The [desktop API reference](docs/desktop-api.md) defines the anonymous, opt-in native report endpoint, catalog matching, required consents, request limits, and duplicate-safe retries. Native v1 accepts no logs or attachments. Browser submission and maintainer authentication keep their existing security boundaries.

## Search engines and AI agents

The server still serves the React app's `index.html` for every page, but `server/seo.ts` fills in each page's head from PostgreSQL first: title, description, canonical URL, robots, Open Graph and Twitter tags, and JSON-LD (`WebSite` with a search action on the home page, `VideoGame` and `BreadcrumbList` on game pages, `BreadcrumbList` on report pages and the desktop guide). There is no rating markup, because reports are observations, not reviews. All values are HTML-escaped, and JSON-LD escapes `<`, `>` and `&`, so report text cannot close the script block. The CSP needs no change because `application/ld+json` is a data block, not a script.

A `<noscript>` summary before `#root` gives clients without JavaScript the heading, status, facts and report links. Browsers with JavaScript never render it, so the app looks exactly as before and nothing flashes before React mounts.

- Unknown games, hidden or unknown reports and unknown routes return 404 with `noindex`. `/submit`, `/submitted/*` and `/maintainer` are `noindex`, and API responses send `X-Robots-Tag: noindex`.
- A trailing slash, a percent-encoded or uppercase report path and `/index.html` redirect permanently to the canonical URL. Query strings never change the canonical URL.
- `/robots.txt` blocks the private areas and the auth, maintainer and native API paths. The public read APIs stay crawlable, because search engines fetch them to render pages.
- `/sitemap.xml` lists the home page, guides, every catalog game and every visible report, with the latest report time as `lastmod`. Hidden reports are excluded.
- `/llms.txt` and `/llms-full.txt` follow [llmstxt.org](https://llmstxt.org/). Every game has a Markdown view at `/games/<slug>.md`, and `/docs/desktop-api.md` serves the desktop API reference. None of them include reporter names, handles or hardware beyond the setup summary.

HTML pages keep `Cache-Control: no-cache`. The sitemap, llms files and Markdown views use `public, max-age=900`, and robots.txt and the API reference use `public, max-age=3600`. The server-side AI crawler hook runs before routing, so it records these reads too.

After deploying, submit `https://lichii.zortos.me/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

## Test

Use a separate PostgreSQL database named `lichii_test`. The integration test **drops and recreates its public schema** and refuses other database names. Do not point it at production or a development database containing work.

```sh
npm run check
npm run build
TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/lichii_test npm test
TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/lichii_test npm run test:privacy
npm audit
```

Tests run migrations and real parameterized queries. They cover the maintainer token boundary, the MCP server over stdio, repeat/concurrent imports, zero reports, search, report persistence, private/public separation, malformed uploads, MIME/size limits, CSRF, SQL-injection-shaped search, OAuth state and PKCE, immutable-ID rejection, expired/forged sessions, every privileged endpoint, audit events, triage/hiding, log deletion/expiry, and durable rate limits with spoofed forwarding headers.

`test:privacy` starts the built application on port 3100 against the same isolated database and drives Chromium. It uses `/usr/local/bin/chromium` when available, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set, or Playwright’s browser installed with `npx playwright install chromium`. The browser maps `lichii.example` to loopback because the production tracker suppresses analytics on localhost. Tests execute the SDK-pinned tracker while intercepting ingestion so test visits never reach Databuddy. They verify automatic analytics, disabled replay even with a previously saved replay choice, browser privacy signals, private-route isolation, and exclusion of page text, inputs and arbitrary URL queries. Internet access to the pinned CDN scripts is required. `seo.spec.ts` runs in the same suite: with JavaScript disabled it checks game, report and 404 pages, and with JavaScript enabled it holds the app bundle to prove no server content shows before React mounts.

## Catalog and artwork

`data/catalog.json` is the validated import contract:

```ts
{
  sgdbId: number;
  slug: string;
  title: string;
  coverPath: string | null;
  heroPath: string | null;
  artworkCredit: string | null;
  artworkSource: string | null;
  releaseDate?: string | null;
  publisher?: string | null;
}
```

Artwork paths must be local `/art/NAME.webp`, `.png`, `.jpg` or `.jpeg` paths. All imported artwork is decoded and reencoded to WebP by the collection scripts, rather than serving upstream HTML or arbitrary original files. Missing art remains missing, with a neutral placeholder. Real Lichii branding is copied from the project’s branding assets, with no color inversion.

The snapshot (7 November 2026) matches Nintendo Europe’s English Switch 2 index and the Nintendo of America store titles that Europe does not list against SteamGridDB. It covers 584 of 784 Nintendo records mapped to 565 unique SGDB IDs; 200 Nintendo records remain unresolved. Every entry from an earlier snapshot keeps its SGDB ID and slug, even when the upstream record disappears. The catalog includes announced games and some editions or bundles. It is **not an exhaustive worldwide Switch 2 list**. SteamGridDB has no console-platform enumeration endpoint, so unresolved records are not proven absent there. The UI states this limit.

`data/provenance.json` preserves Nintendo membership, artwork IDs, authors and original URLs. `coverage.json`, `source-coverage.json` and `unmatched-nintendo.json` record coverage and the unresolved review queue. These files are not public API payloads. Art credits are shown per game. Shared SGDB entries may have artwork from an original edition rather than a dedicated Switch 2 cover. Attribution does not itself provide copyright clearance.

See `scripts/catalog/README.md` to reproduce discovery, matching, carrying the published catalog forward and image conversion. Regenerate deliberately, review the unmatched queue and artwork, replace the checked-in export, then deploy. There is no automatic upstream sync and no API-key dependency at runtime.

## Compatibility views

The home page follows the Ledger frames in Paper: the catalog status bar, then a community status band with the median result and per-platform bars, then the latest 8 results as colored rows, then the games table and a by-build table. Every number comes from public reports. With no reports, each block shows an empty state instead of placeholder figures.

The site derives platform and build from the free-text fields players already submit. The report schema and the native desktop contract are unchanged. All derivation lives in `shared/compat.ts`, which the server and the browser both import:

- **Platform** comes from `os`, `cpu` and `gpu`. Steam Deck hardware (the words "Steam Deck", the Van Gogh/Aerith or Sephiroth APUs, "Custom APU/GPU 0405/0932") always counts as Steam Deck, even under Windows. SteamOS without a named desktop GPU counts as Steam Deck, and SteamOS with one counts as Linux. After that the order is macOS (including Apple M-series hardware), Windows, then Linux distributions and RADV/Mesa drivers. Anything else is Other.
- **Lichii build** is the number after `build` (`build-93`, `Build 93`, `nx2-build-93`, `Lichii build-93 (09b78bd2dfdd)`) or a bare number (`93`). Commit-only, fork and version-like strings (`9.3`, `1973c1df56-HEAD`) are grouped under **Other / unknown**. They are never guessed.
- **Median** is the middle rating on the ordinal scale Unplayable < Loads < Runs < Playable < Perfect. For an even count it takes the lower of the two middle ratings, so it never overstates compatibility.
- **Playable share** is the share of reports rated Playable or Perfect.
- **Best result on** summarises the highest-rated report for a game (newest wins ties) as GPU family, graphics API and OS, for example `RTX 40 · Vulkan · Win 11`. If the best report is Unplayable, the table says "No working report yet".
- **Last 8 builds** shows the 8 consecutive build numbers that end at the newest build anyone reported. Each square is that game's best result on that build. Gray means nobody reported it on that build.

A game's `status` is still its latest visible report, as before. Platform toggles and the build selector filter reports. When they are active, the games table only lists games with matching reports, and each row's figures cover only those reports. The top-of-page status counts always cover the whole catalog.

Read-only API additions, all backward compatible:

- `GET /api/games` and `GET /api/games/:slug` add `median`, `best` (`{ outcome, setup }` or `null`), `latestVersion` and `recentBuilds` (`[{ build, status }]`) per game, and `latestBuild` at the top level. `/api/games` accepts `platform` (comma-separated `steam-deck`, `windows`, `linux`, `macos`, `other`) and `lichiiBuild` (a number or `other`). Existing fields, page size, sorting and the desktop search query are unchanged.
- `GET /api/reports` accepts the same `platform` and `lichiiBuild` filters and adds `gameCoverPath` to each report.
- `GET /api/summary` returns the overall tally, per-platform tallies, per-build tallies (newest first, Other / unknown last), `gamesTested` and `latestBuild`. It accepts `gameId`, `platform` and `lichiiBuild`.

Aggregates are computed per request from the visible reports with the shared functions, so the server and the UI cannot disagree. This is cheap at the current volume, but it scans all visible reports. Add caching or stored derived columns before the report count reaches the tens of thousands.

Platform logos come from [Simple Icons](https://simpleicons.org) (CC0-1.0), bundled through npm and rendered as inline SVG, so the `img-src 'self'` CSP is untouched. The logos remain trademarks of their owners. Simple Icons does not ship Microsoft marks, so Windows uses a plain four-pane glyph. UI glyphs use Lucide (ISC).

## Reporting and maintenance

1. Pick a game and choose **Submit a report**.
2. Optionally select `eden_log.txt`, found through **File → Open Lichii Folders → Log Folder**. It is still named `eden_log.txt` in the emulator.
3. Read the local preview and remove personal data in a text editor if necessary. Apply detected fields only after review.
4. Enter missing build, game version, hardware, settings, outcome, progress, summary and reproduction details. Unknown information must be marked unknown, not guessed.
5. Enter a name and optional X handle. Consent to the public report and, if attached, the private log. Submit once.

The parser recognizes known source-file log lines for build, CPU, OS, RAM, Vulkan device/driver/API and booted game version. It also reads an allowlist of rendering, CPU accuracy, console mode and memory layout settings from `settings.cpp:LogSettings`, including the graphics backend. Only bounded enum, boolean and numeric values are copied, not paths, device names or controller configuration. Repeated settings use their last logged value. Review them against the game session you are reporting, especially when a log contains multiple boots. A later empty boot version clears the earlier detected version rather than reusing it. The form identifies missing fields without inventing values; startup-only logs often have no renderer or game information. Outcome and progress stay manual. Parsed values are untrusted observations, never authenticated telemetry, and never imply compatibility, performance or FPS.

The settings form uses graphics API choices, resolution and GPU accuracy selectors, and an async shader toggle. These controls start Unknown until the author selects a value or applies a log. Other detected settings remain editable in the optional notes field. The form serializes controls and notes into the existing public settings text, so stored reports and API clients keep the same format.

The public report contains only explicitly entered fields. Logs are separate PostgreSQL `bytea` rows and have no public URL, filename or API field. Maintainers sign in at `/maintainer`, select a report, view or download a private log, save a triage state/internal note, hide spam, or delete a log. Private reads and mutations create audits without log contents.

Logs become inaccessible at 90 days. Hourly and startup cleanup deletes expired rows from the live database. Public reports remain. Backups have their own infrastructure retention policy. The privacy page explains the distinction. There are no author accounts or self-service editing tokens; removal requests go to the maintainer.

## Maintainer view

`/maintainer` follows the Ledger design's maintainer log frame (`05b` in the Paper file). It stays behind GitHub sign-in and never mounts analytics.

- The queue is a table of every report, hidden ones included, newest first. Filter it by triage state, outcome, platform, GPU vendor, Lichii build and private-log presence, or search by report ID, game, summary, reporter name or handle. Platform and build come from the same `shared/compat.ts` derivation as the public pages.
- A report opens at `/maintainer?report=<id>`. The private log stays closed until you open it, because every read creates an audit record. The viewer shows line numbers and columns for timestamp, module and level. It has level filters with counts, search with highlighting, jumps to system info, config, game boot and the first critical or error line, links to a selected line (`&line=<n>`) and a download.
- After you open a log, a table compares the reporter's build, version, hardware, graphics API and shared settings with the values that `shared/log.ts` reads from the log.
- Shortcuts: `/` search, `j`/`k` move through the queue, `Enter` open, `Esc` back, `[`/`]` previous and next report, `o` open the log, `1`–`4` choose new, reviewed, needs info or hidden, `Ctrl`/`⌘` + `Enter` save.

## Maintainer API token and MCP server

The maintainer API (`/api/maintainer/*`) also accepts a bearer token, so agents can triage without a browser session. Token auth is off unless `MAINTAINER_API_TOKEN_SHA256` is set. Production stores only the SHA-256 hex digest of the token, never the token.

### Create or rotate the token

1. Generate a token and its digest on your own machine:

   ```sh
   token=$(openssl rand -hex 32)
   printf %s "$token" | sha256sum | cut -d' ' -f1
   ```

2. Set the printed digest as `MAINTAINER_API_TOKEN_SHA256` on the Railway service and redeploy. An empty value disables token auth. A malformed value stops startup.
3. Give the token itself only to the MCP server as `LICHII_MAINTAINER_TOKEN`.

To rotate, repeat the steps. The old token stops working when the new digest deploys. To revoke without a replacement, delete the variable.

### Boundary

- Tokens are 32–256 URL-safe characters, sent as `Authorization: Bearer <token>`. The server hashes the presented token and compares the digest with `crypto.timingSafeEqual`.
- A request with an `Authorization` header on a maintainer route is checked only as a token request. If it also sends any cookie or an `Origin` header, the server rejects it with 400, even when the session is valid.
- Token requests skip the browser Origin check only when all of these are true: the matched route is a maintainer API route, no cookie and no `Origin` are sent, and the token is valid. Every other route, including the native desktop endpoint, keeps its existing checks. A token grants nothing on public or auth routes.
- Token requests have their own limit of 120 per minute per IP address. Responses are `no-store`. The logger never serializes requests or headers, so the token and `Authorization` header are never logged. Audit events record the actor `api-token`.
- Triage updates accept a triage state, an internal note or both. Omitted fields keep their stored value, so two partial updates can't overwrite each other.

### MCP server

`tools/maintainer-mcp/server.mjs` is a stdio MCP server with no dependencies. Run it with Node.js 18 or later. It doesn't need `npm ci`.

```sh
LICHII_MAINTAINER_TOKEN=<token> node tools/maintainer-mcp/server.mjs
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `LICHII_MAINTAINER_TOKEN` | Yes | The maintainer API token. Tool calls fail with a clear message without it. |
| `LICHII_BASE_URL` | No | Site origin, default `https://lichii.zortos.me`. Plain `http` is allowed only for `localhost`, `127.0.0.1` and `[::1]`. |

| Tool | Maps to | Notes |
| --- | --- | --- |
| `list_reports` | `GET /api/maintainer/reports` | Filters: query, triage, status, platforms, build, has_log, game_id, page. Returns counts per triage state. |
| `get_report` | `GET /api/maintainer/reports/:id` | All fields, the internal note and the log expiry. No log contents. |
| `get_report_log` | `GET /api/maintainer/reports/:id/log` | Line-numbered text, filterable by search and levels, capped by `max_bytes` (default 64 KiB, at most 512 KiB) with a truncation notice. Expired or deleted logs return an error. Each call writes a `read-log` audit row. |
| `update_triage` | `PATCH /api/maintainer/reports/:id` | Set the triage state, the internal note or both. `hidden` removes the report from public pages and aggregates. |
| `delete_report_log` | `DELETE /api/maintainer/reports/:id/log` | Destructive and irreversible. Requires `confirm: true`. |

The server validates report IDs as UUIDs before it builds a URL, refuses redirects, sends `DNT: 1` so the AI crawler reporting hook skips its requests, and replaces the token with `[redacted]` in everything it writes.

**Private logs fetched through the MCP land in the agent's transcript.** Treat a transcript that called `get_report_log` as private data. Read a log only when the task needs it, and narrow it with `search` or `levels`.

## Databuddy visitor analytics

`@databuddy/sdk/react` uses the public client ID `da37ce88-b18d-4639-a886-b2e74119b0ad` from `shared/databuddy.ts`. Visitor analytics and Web Vitals load automatically on known public pages. There is no consent prompt or session recording. Do Not Track, Global Privacy Control and the SDK’s opt-out controls remain respected.

Analytics measures public-page visits and Web Vitals, including page and referrer paths, browser/device information and approximate location. The tracker can collect selected campaign parameters and creates browser-local anonymous and session identifiers. Error, attribute, outgoing-link and custom interaction tracking are disabled. We do not identify visitors by name or send report fields as events. See [Databuddy’s security documentation](https://www.databuddy.cc/docs/security) for its storage and processing behavior.

Crawlers and coding agents such as GPTBot, ClaudeBot and Claude Code do not run JavaScript, so a global Fastify `onRequest` hook calls `trackAgents` from `@databuddy/sdk/agents` on every request, including static files, `.md`, `.txt`, `llms.txt`, the SPA fallback, API routes and 404s. It is fire-and-forget: the hook never awaits it and swallows rejections, and the SDK times out after 3 seconds. The hook passes only the method, raw URL and the `User-Agent`, `Accept`, `Signature-Agent`, `Sec-Fetch-Mode` and `Referer` headers, with `Host` fixed to `APP_ORIGIN`. Cookies, `Authorization`, forwarding headers and bodies never reach the SDK, and requests with Do Not Track or Global Privacy Control are skipped. The SDK posts to `https://basket.databuddy.cc/ai-traffic` only for `GET` and `HEAD` requests from known AI user agents, signed agent browsers or non-browser clients asking for Markdown first, skipping images, scripts, styles and fonts. It sends the path without its query, host, user agent, `Accept`, referrer, signature agent, format and website ID, but no client IP. `DATABUDDY_WEBSITE_ID` can override the website ID, which defaults to the client ID in `shared/databuddy.ts`.

Session replay is explicitly disabled in the SDK. No recorder script is loaded and no DOM snapshots, text, typed inputs, clicks or mouse movements are recorded. Previously saved replay preferences cannot enable it.

Only known public catalog, game, report, guide and privacy routes may mount the SDK. `/submit`, `/submitted/:id`, `/maintainer`, their descendants and unknown routes never mount it. Links crossing this boundary perform a full-document navigation. `TrackingBoundary` also refuses to render the destination when programmatic SPA navigation crosses it, disables analytics, and reloads before any private component mounts.

SDK 3.4.7 pins date-versioned CDN scripts with integrity hashes. Removing a script tag alone cannot prevent an in-flight script from executing, so private content never renders in a document that loaded tracking. Keep this boundary when adding links or routes: use `src/navigation.tsx`, and explicitly review additions to the public-route allowlist.

CSP allows scripts only from self and `https://cdn.databuddy.cc`, and connections only to self and `https://basket.databuddy.cc`. Web Vitals are collected by the tracker. No wildcard, external image, iframe or worker origin is required. Check origins and lifecycle behavior again before upgrading the SDK.

## Launch security and scope

- JSON bodies are bounded before parsing to 1,100 KiB. Logs are at most 512 KiB of UTF-8 text, checked both in the browser and on the server, with a database byte-length constraint.
- Archives, binaries, HTML/SVG, unexpected content types and malformed report fields are rejected. Uploaded filenames are validated then discarded. Screenshot uploads are intentionally not supported.
- React escapes all report/log content. There is no raw HTML rendering. CSP keeps styles, images and fonts local, limits external scripts and connections to the Databuddy origins above, and prohibits embedding and objects. Additional headers include `nosniff`, no-referrer, HSTS in production and a restrictive Permissions Policy.
- All mutations require the exact configured Origin and JSON content type. Cross-site Fetch Metadata is rejected. The only exception is a valid maintainer API token on a maintainer route with no cookie and no Origin, described above. SQL uses parameterized queries; the only raw SQL is the checked-in migration file.
- Submission attempts are limited to five per IP per hour, OAuth starts to twenty per IP per hour, maintainer API token requests to 120 per IP per minute, and other APIs to 240 requests per IP per minute. A global 1,000-report daily limit bounds storage abuse. Limits are atomic and durable across restarts. IP-derived keys are HMAC hashes, not raw addresses, and expire.
- Visitor analytics excludes reporting and maintainer pages; session replay is disabled. The server suppresses request/body/error serialization that could disclose logs, tokens or queries. Error responses do not expose stack traces or database errors.
- Anonymous content is still untrusted. Rate limits and a honeypot reduce abuse but cannot stop distributed determined spam. The maintainer can hide reports. No automatic consensus, deduplication, issue matching, voting, benchmark inference or screenshot service is claimed.

## Code map

- `shared/domain.ts`: Zod boundary schemas and shared report/catalog types.
- `shared/compat.ts`: platform, build, GPU family, setup summary, median and playable-share derivation shared by server and browser.
- `server/insights.ts`: per-game, per-platform and per-build aggregation over visible reports.
- `src/insights.tsx`: platform icons and toggles, build selector, distribution bars, build strip and build table.
- `shared/log.ts`: bounded log validation and conservative local extraction.
- `server/app.ts`: HTTP security boundary, public APIs and protected maintainer APIs.
- `server/auth.ts`: GitHub OAuth, database-backed sessions and the maintainer API token check.
- `src/maintainer.tsx`: maintainer queue, report detail, private log viewer and triage.
- `tools/maintainer-mcp/server.mjs`: dependency-free stdio MCP server for the maintainer API.
- `server/db.ts` and `server/migrations/`: locked preparation, import and retention.
- `src/`: React routes, accessible forms and dark responsive Tailwind UI.
- `tests/`: pure validation/parser checks and isolated PostgreSQL integration tests.
