#!/usr/bin/env node
import { createInterface } from 'node:readline';

const version = '1.0.0';
const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const triageStates = ['new', 'reviewed', 'needs-info', 'hidden'];
const outcomes = ['Perfect', 'Playable', 'Runs', 'Loads', 'Unplayable'];
const platforms = ['steam-deck', 'windows', 'linux', 'macos', 'other'];
const levels = ['Critical', 'Error', 'Warning', 'Info', 'Debug', 'Trace'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultLogBytes = 64 * 1024;
const maxLogBytes = 512 * 1024;

class ToolError extends Error {}

function readBaseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('LICHII_BASE_URL must be an absolute URL such as https://lichii.zortos.me.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('LICHII_BASE_URL must use https (plain http is allowed only for localhost).');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('LICHII_BASE_URL must be an origin without credentials, a path or a query.');
  return url;
}

let baseUrl;
try { baseUrl = readBaseUrl(process.env.LICHII_BASE_URL || 'https://lichii.zortos.me'); }
catch (error) { process.stderr.write(`lichii-maintainer-mcp: ${error.message}\n`); process.exit(1); }
const token = process.env.LICHII_MAINTAINER_TOKEN ?? '';
const redact = text => token ? text.split(token).join('[redacted]') : text;

async function request(method, path, { query, body } = {}) {
  if (!token) throw new ToolError('LICHII_MAINTAINER_TOKEN is not set. Add the maintainer API token to this MCP server\'s environment.');
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000), body: body === undefined ? undefined : JSON.stringify(body),
      headers: { authorization: 'Bearer ' + token, accept: 'application/json, text/plain', dnt: '1', 'user-agent': 'lichii-maintainer-mcp/' + version, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'the request timed out' : error?.cause?.code ?? 'a network error';
    throw new ToolError(`Could not reach ${baseUrl.origin}: ${reason}.`);
  }
  if (response.ok) return response;
  const detail = await response.json().then(data => typeof data?.error === 'string' ? data.error : '', () => '');
  const retry = response.headers.get('retry-after');
  throw new ToolError(`${method} ${url.pathname} failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}${retry ? ` Retry after ${retry} seconds.` : ''}`);
}

const getJson = async (path, query) => (await request('GET', path, { query })).json();

function reportId(args) {
  if (typeof args.id !== 'string' || !uuid.test(args.id)) throw new ToolError('id must be a report UUID, for example 3f2c1a9e-8d4b-4c2a-9f1e-2b7d6c5a4e3f.');
  return args.id.toLowerCase();
}
function oneOf(name, value, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new ToolError(`${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}
function list(name, value, allowed) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ToolError(`${name} must be a list drawn from: ${allowed.join(', ')}.`);
  return value.map(item => oneOf(name, item, allowed));
}
function integer(name, value, min, max) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) throw new ToolError(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}
function text(name, value, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new ToolError(`${name} must be text of at most ${max} characters.`);
  return value;
}

const summary = report => ({
  id: report.id, createdAt: report.createdAt, triage: report.triage, outcome: report.outcome, game: report.gameTitle,
  summary: report.summary, reporter: report.name, build: report.build, gameVersion: report.gameVersion, os: report.os, gpu: report.gpu,
  hasLog: report.hasLog, logExpiresAt: report.logExpiresAt, internalNote: report.internalNote,
});

function formatLog(id, log, args) {
  const search = text('search', args.search, 200)?.toLowerCase();
  const wanted = list('levels', args.levels, levels);
  const limit = integer('max_bytes', args.max_bytes, 1024, maxLogBytes) ?? defaultLogBytes;
  const lines = log.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const width = String(lines.length).length;
  const matching = lines.map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => (!wanted?.length || wanted.some(level => line.includes(`<${level}>`))) && (!search || line.toLowerCase().includes(search)));
  const kept = [];
  let bytes = 0;
  for (const { line, number } of matching) {
    const row = `${String(number).padStart(width)} | ${line}`;
    const size = Buffer.byteLength(row) + 1;
    if (bytes + size > limit) break;
    kept.push(row);
    bytes += size;
  }
  const filtered = search || wanted?.length ? `, ${matching.length} matching the filter` : '';
  const header = [
    `Private log for report ${id}: ${lines.length} lines, ${Buffer.byteLength(log)} bytes${filtered}.`,
    'This read was recorded in the audit log. Logs are kept for 90 days after submission and are never public.',
  ];
  if (kept.length < matching.length) header.push(`TRUNCATED: showing the first ${kept.length} of ${matching.length} lines (max_bytes ${limit}). Narrow with search or levels, or raise max_bytes up to ${maxLogBytes}.`);
  return [...header, '', ...kept].join('\n');
}

const idProperty = { type: 'string', format: 'uuid', description: 'Report UUID.' };
const tools = [
  {
    name: 'list_reports',
    title: 'List compatibility reports',
    description: 'List and search reports in the maintainer queue, newest first, 15 per page. Includes hidden reports, triage state, internal notes and whether a private log is attached. Returns totals per triage state.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', maxLength: 150, description: 'Text to find in the report ID, game title, summary, reporter name or handle.' },
      triage: { type: 'string', enum: ['any', ...triageStates], description: 'Triage state. Defaults to any.' },
      status: { type: 'string', enum: ['Any', ...outcomes], description: 'Reported outcome. Defaults to Any.' },
      platforms: { type: 'array', items: { type: 'string', enum: platforms }, description: 'Platforms derived from the reported OS, CPU and GPU.' },
      build: { type: 'string', pattern: '^(\\d{1,4}|other)$', description: 'Lichii build number, or "other" for builds that could not be read.' },
      has_log: { type: 'string', enum: ['any', 'attached', 'none'], description: 'Whether an unexpired private log is attached.' },
      game_id: { type: 'integer', minimum: 1, description: 'SteamGridDB game ID.' },
      page: { type: 'integer', minimum: 1, maximum: 10000, description: 'Page number. Defaults to 1.' },
    } },
    async run(args) {
      const build = text('build', args.build, 5);
      if (build !== undefined && !/^(\d{1,4}|other)$/.test(build)) throw new ToolError('build must be a build number such as 93, or "other".');
      const data = await getJson('/api/maintainer/reports', {
        q: text('query', args.query, 150), triage: oneOf('triage', args.triage, ['any', ...triageStates]), status: oneOf('status', args.status, ['Any', ...outcomes]),
        platform: list('platforms', args.platforms, platforms)?.join(','), lichiiBuild: build, log: oneOf('has_log', args.has_log, ['any', 'attached', 'none']),
        gameId: integer('game_id', args.game_id, 1, Number.MAX_SAFE_INTEGER), page: integer('page', args.page, 1, 10000),
      });
      return { page: data.page, pageCount: data.pageCount, total: data.total, countsByTriage: data.counts, reports: data.reports.map(summary) };
    },
  },
  {
    name: 'get_report',
    title: 'Get a report',
    description: 'Get every field of one report, including hidden reports, the internal note, triage state and private log availability and expiry. Does not return log contents.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: idProperty } },
    run: args => getJson(`/api/maintainer/reports/${reportId(args)}`),
  },
  {
    name: 'get_report_log',
    title: 'Read a private log',
    description: 'Read the private eden_log.txt attached to a report, with line numbers. PRIVATE DATA: the returned text lands in this agent transcript, and every call creates a read-log audit record. Expired or deleted logs are unavailable. Output is capped by max_bytes with a truncation notice; filter with search or levels to see the relevant lines.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: idProperty,
      search: { type: 'string', maxLength: 200, description: 'Only lines containing this text, case-insensitive.' },
      levels: { type: 'array', items: { type: 'string', enum: levels }, description: 'Only lines at these log levels.' },
      max_bytes: { type: 'integer', minimum: 1024, maximum: maxLogBytes, description: `Maximum bytes of log lines to return. Defaults to ${defaultLogBytes}.` },
    } },
    async run(args) {
      const id = reportId(args);
      const log = await (await request('GET', `/api/maintainer/reports/${id}/log`)).text();
      return formatLog(id, log, args);
    },
  },
  {
    name: 'update_triage',
    title: 'Triage a report',
    description: 'Set a report\'s triage state, its internal maintainer note, or both. "hidden" removes the report from every public page and aggregate until it is set to another state. The note is never public. Omitted fields keep their current value.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: idProperty,
      triage: { type: 'string', enum: triageStates, description: 'new, reviewed, needs-info, or hidden (removed from public pages).' },
      internal_note: { type: 'string', maxLength: 6000, description: 'Replaces the internal note. Send an empty string to clear it.' },
    } },
    async run(args) {
      const id = reportId(args);
      const triage = oneOf('triage', args.triage, triageStates);
      const note = text('internal_note', args.internal_note, 6000);
      if (triage === undefined && note === undefined) throw new ToolError('Send triage, internal_note, or both.');
      await request('PATCH', `/api/maintainer/reports/${id}`, { body: { triage, internalNote: note } });
      return summary(await getJson(`/api/maintainer/reports/${id}`));
    },
  },
  {
    name: 'delete_report_log',
    title: 'Delete a private log',
    description: 'DESTRUCTIVE and irreversible: permanently delete the private log attached to a report before its 90-day expiry. The public report stays. Requires confirm: true. Creates a delete-log audit record.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'confirm'], properties: {
      id: idProperty,
      confirm: { type: 'boolean', const: true, description: 'Must be true to confirm the permanent deletion.' },
    } },
    async run(args) {
      const id = reportId(args);
      if (args.confirm !== true) throw new ToolError('Set confirm to true to permanently delete this log.');
      await request('DELETE', `/api/maintainer/reports/${id}/log`, { body: {} });
      return `Deleted the private log for report ${id}. The public report is unchanged.`;
    },
  },
];

const instructions = 'Maintainer tools for the Lichii compatibility website at ' + baseUrl.origin + '. Reports are public community submissions; private logs and internal notes are not. Only read a private log when the task needs it, because its contents land in the transcript.';

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return { protocolVersion: protocolVersions.includes(requested) ? requested : protocolVersions[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'lichii-maintainer', title: 'Lichii maintainer', version }, instructions };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: tools.map(({ run, ...definition }) => definition) };
  if (method === 'tools/call') {
    const tool = tools.find(candidate => candidate.name === params?.name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${String(params?.name)}`), { code: -32602 });
    try {
      const result = await tool.run(params.arguments ?? {});
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const reason = error instanceof ToolError ? error.message : 'The tool failed unexpectedly.';
      return { isError: true, content: [{ type: 'text', text: reason }] };
    }
  }
  throw Object.assign(new Error(`Method not found: ${String(method)}`), { code: -32601 });
}

const send = message => process.stdout.write(redact(JSON.stringify({ jsonrpc: '2.0', ...message })) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  if (line.length > 1024 * 1024) return send({ id: null, error: { code: -32600, message: 'Message too large' } });
  let message;
  try { message = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return send({ id: null, error: { code: -32600, message: 'Invalid request' } });
  if (message.id === undefined) return;
  if ((typeof message.id !== 'string' && typeof message.id !== 'number') || typeof message.method !== 'string') return send({ id: null, error: { code: -32600, message: 'Invalid request' } });
  handle(message).then(
    result => send({ id: message.id, result }),
    error => send({ id: message.id, error: { code: error.code ?? -32603, message: error.code ? error.message : 'Internal error' } }),
  );
});
