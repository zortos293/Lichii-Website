# Desktop compatibility report API v1

The API accepts anonymous, user-reviewed Switch 2 compatibility reports. It has no account, pairing flow, or embedded API secret. A report becomes public only after the player confirms the catalog match, reviews the draft, checks both consent boxes, and clicks Submit.

The website's same-origin submission endpoint remains unchanged. Native v1 accepts no logs, attachments, filenames, paths, or play-history fields. Measured session performance can be included in editable `details` or `settings` text. Missing hardware and version values can be entered as `Unknown`; compatibility outcome and progress are always the player's judgment.

## Catalog lookup

`GET https://lichii.zortos.me/api/games?q=<URL-encoded-title>&page=1&sort=title`

The response contains `games`, `page`, `pageCount`, and `total`. Each game includes `sgdbId`, `slug`, `title`, and its Switch 2 catalog metadata. The player confirms the matching title before submission. `gameId` is the selected `sgdbId`, not the Nintendo title ID. There is no automatic title-ID mapping.

`q` is trimmed, permits an empty search, and has a maximum length of 150 UTF-16 code units. Search matches a case-insensitive substring of the title or publisher. `page` defaults to 1 and accepts integers from 1 to 10,000. `sort` accepts `title`, `popular`, or `recent` and defaults to `popular`. A page contains at most 15 games; the page size is fixed. `pageCount` is at least 1, even when `total` is zero. An out-of-range page returns an empty `games` array.

The complete response shape is:

```ts
{
  games: Array<{
    sgdbId: number;
    slug: string;
    title: string;
    coverPath: string | null;
    heroPath: string | null;
    artworkCredit: string | null;
    artworkSource: string | null;
    releaseDate?: string | null;
    publisher?: string | null;
    reportCount: number;
    status: 'Perfect' | 'Playable' | 'Runs' | 'Loads' | 'Unplayable' | 'Untested';
    latestAt: string | null;
  }>;
  page: number;
  pageCount: number;
  total: number;
  totalGames: number;
  totalReports: number;
  counts: {
    Perfect: number;
    Playable: number;
    Runs: number;
    Loads: number;
    Unplayable: number;
    Untested: number;
  };
}
```

IDs, page numbers, and counts are JSON integers, not strings. `latestAt` is an ISO timestamp when present. Catalog lookup requires no cookies, credentials, or custom protocol header. The client can ignore unused metadata. Invalid query parameters return `400`; reads share a 240-requests-per-IP-per-minute limit and can return `429` with `Retry-After`.

## Submission request

`POST https://lichii.zortos.me/api/v1/desktop/reports`

Required headers:

```http
Content-Type: application/json
X-Lichii-Client: desktop/1
Idempotency-Key: <random UUID without braces>
```

The client uses a dedicated unauthenticated request. Requests containing `Origin`, `Cookie`, `Authorization`, or any `Sec-Fetch-*` header are rejected. The protocol header is not authentication. No CORS access is granted, and the existing browser endpoint does not accept these headers as a substitute for its CSRF checks. HTTPS is required in production; local fixtures use an explicitly configured local origin.

The JSON body is limited to 128 KiB. Unknown keys are rejected, including `log`, `privateLogConsent`, `website`, client-supplied titles, and telemetry objects. The following fields form the complete body:

| Field | Type and limit |
| --- | --- |
| `gameId` | Positive integer, confirmed SteamGridDB ID in the server catalog. |
| `name` | Required string, 1–60 characters. A nickname or explicitly shown `Anonymous` is allowed. |
| `handle` | Optional string, empty or 1–15 ASCII letters, digits, or underscores with an optional leading `@`. |
| `build` | Required string, 1–100 characters. |
| `gameVersion` | Required string, 1–60 characters. |
| `cpu`, `gpu`, `driver`, `os` | Required strings, 1–160 characters each. |
| `ram` | Optional string, up to 60 characters. |
| `graphicsApi` | `Vulkan`, `OpenGL`, or `Unknown`. |
| `settings` | Required string, 1–3,000 characters. |
| `outcome` | `Perfect`, `Playable`, `Runs`, `Loads`, or `Unplayable`. |
| `progress` | Required string, 1–500 characters. |
| `summary` | Required string, 1–120 characters. |
| `details` | Required string, 1–6,000 characters. |
| `reproduction` | Optional string, up to 3,000 characters. |
| `updates`, `mods` | Optional strings, up to 500 characters each. |
| `publicConsent` | Required literal `true`, separately affirmed by the player. |
| `safeFilesConsent` | Required literal `true`, separately affirmed by the player. |

Text values are trimmed. Optional strings default to empty strings. Report text rejects control characters other than tab, line feed, and carriage return. Limits use JavaScript string length, so a character outside the Basic Multilingual Plane occupies two code units.

Consent wording for the native form:

- `publicConsent`: “I understand my name, optional X handle, report text, hardware and settings will be public.”
- `safeFilesConsent`: “My report contains no game files, keys, firmware, saves or private account details.”

Both boxes start unchecked. `safeFilesConsent` is a statement about report contents, not permission to attach files. Native v1 has no log-upload path.

## Receipts and retries

The first successful submission returns `201` with exactly this shape:

```json
{
  "id": "<report UUID>",
  "url": "https://lichii.zortos.me/reports/<report UUID>"
}
```

An identical validated payload with the same UUID key returns `200` and the same receipt. This also holds for concurrent requests. Reusing the key with a different validated payload returns `409` without changing the original report. Whitespace trimming and omitted optional defaults do not create a different validated payload. Request keys remain attached to their report; there is no short retry expiry.

The desktop retains the key and unchanged payload after a timeout or uncertain response. A retry requires an explicit user action; it does not silently generate a new key. Editing a draft and confirming another submission uses a new key. The key does not authenticate a player and is not included in public report responses.

Native and browser submissions share the same five-requests-per-IP-per-hour quota and 1,000-new-reports-per-UTC-day global cap. Every attempt, including a retry or invalid body, counts against the IP quota once it passes the protocol checks. An idempotent replay consumes no new global slot. This endpoint is public, not proof that a request came from an official binary.

## Error responses

Errors are JSON objects with `error`, plus optional `fields` mapping field names to arrays of messages. Responses never echo the submitted body, private notes, or request hashes.

| Status | Meaning |
| --- | --- |
| `400` | Invalid UUID key, missing consent, invalid report field, unknown JSON key, or unknown catalog game. |
| `403` | Wrong native protocol header, browser metadata, or supplied credentials. |
| `409` | The request key was already used for different report contents. |
| `413` | The body exceeds 128 KiB. |
| `415` | The request is not JSON. |
| `429` | Shared IP or global submission quota exceeded. `Retry-After` contains seconds. |
| `500`, `503` | Service unavailable or an uncertain server failure. A user-triggered retry keeps the original key and body. |

The client displays field errors without discarding the editable draft. It honors `Retry-After`, rejects unexpected redirects, and never forwards the body or headers to a different origin. Automated tests use local or mocked endpoints, never synthetic production reports.
