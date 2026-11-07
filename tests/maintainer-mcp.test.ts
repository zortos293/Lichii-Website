import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { prepareDatabase } from '../server/db.ts';
import { sourceLog, validSubmission } from './fixtures.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
const sql = postgres(databaseUrl, { connection: { search_path: 'maintainer_mcp' }, onnotice: () => {} });
const token = randomBytes(32).toString('hex');
const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'mcp-test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'mcp-test-rate-secret'.repeat(3), NODE_ENV: 'test', MAINTAINER_API_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') });
const app = await createApp(config, sql, false);
const serverPath = fileURLToPath(new URL('../tools/maintainer-mcp/server.mjs', import.meta.url));
let baseUrl = '';
const longLog = sourceLog + Array.from({ length: 4000 }, (_, i) => `[  20.${String(i).padStart(6, '0')}] Render.Vulkan <Info> pipeline_cache.cpp:88:Load: Synthetic pipeline ${i}`).join('\n') + '\n';

type Message = { id?: number; result?: Record<string, unknown> & { content?: { text: string }[]; isError?: boolean }; error?: { code: number; message: string } };
function connect(env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [serverPath], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map<number, (message: Message) => void>();
  let output = '';
  createInterface({ input: child.stdout }).on('line', line => {
    output += line + '\n';
    const message = JSON.parse(line) as Message;
    if (message.id !== undefined) waiting.get(message.id)?.(message);
  });
  child.stderr.on('data', chunk => { output += String(chunk); });
  let next = 1;
  const rpc = (method: string, params?: unknown) => new Promise<Message>(resolve => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await rpc('tools/call', { name, arguments: args })).result;
    assert.ok(result?.content?.[0]);
    return { text: result.content[0].text, isError: result.isError === true };
  };
  return { child, rpc, call, output: () => output, close: async () => { child.stdin.end(); await once(child, 'exit'); } };
}
const maintainer = () => connect({ LICHII_BASE_URL: baseUrl, LICHII_MAINTAINER_TOKEN: token });

before(async () => {
  await sql`DROP SCHEMA IF EXISTS maintainer_mcp CASCADE`;
  await sql`CREATE SCHEMA maintainer_mcp`;
  await prepareDatabase(sql);
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});
after(async () => { await app.close(); await sql`DROP SCHEMA maintainer_mcp CASCADE`; await sql.end(); });

async function submit(change: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/api/reports', headers: { origin: config.APP_ORIGIN, 'content-type': 'application/json' }, payload: { ...validSubmission, ...change } });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.json().id);
}

test('the stdio server negotiates MCP and lists one tool per maintainer capability', async t => {
  const client = maintainer();
  t.after(client.close);
  const init = await client.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result?.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result?.capabilities, { tools: { listChanged: false } });
  client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.equal((await client.rpc('initialize', { protocolVersion: '1999-01-01' })).result?.protocolVersion, '2025-11-25');
  const listed = (await client.rpc('tools/list')).result?.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[];
  assert.deepEqual(listed.map(tool => tool.name), ['list_reports', 'get_report', 'get_report_log', 'update_triage', 'delete_report_log']);
  assert.deepEqual(listed.filter(tool => tool.annotations.destructiveHint).map(tool => tool.name), ['delete_report_log']);
  assert.deepEqual(listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name), ['list_reports', 'get_report', 'get_report_log']);
  assert.deepEqual(await client.rpc('ping'), { jsonrpc: '2.0', id: 4, result: {} });
  assert.equal((await client.rpc('tools/call', { name: 'drop_database', arguments: {} })).error?.code, -32602);
  assert.equal((await client.rpc('resources/list')).error?.code, -32601);
  const before = client.output().length;
  for (const line of ['null', '[]', '"text"', '{"jsonrpc":"2.0","id":{},"method":"ping"}', '{"jsonrpc":"2.0","id":9']) client.child.stdin.write(line + '\n');
  assert.deepEqual((await client.rpc('ping')).result, {});
  const replies = client.output().slice(before).trim().split('\n').map(line => JSON.parse(line) as Message);
  assert.deepEqual(replies.slice(0, 5).map(reply => reply.error?.code), [-32600, -32600, -32600, -32600, -32700]);
  assert.equal(client.child.exitCode, null);
  const echoed = await client.rpc('ping');
  client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: `id-${token}`, method: 'ping' }) + '\n');
  await client.rpc('ping');
  assert.ok(echoed.result);
  assert.equal(client.output().includes(token), false);
  assert.match(client.output(), /"id":"id-\[redacted\]"/);
});

test('every tool works end to end against the API with a token', async t => {
  const id = await submit({ log: { name: 'eden_log.txt', mime: 'text/plain', text: longLog }, build: 'Lichii build-93', os: 'SteamOS 3.7', gpu: 'AMD Custom GPU 0405', summary: 'Synthetic MCP report' });
  const other = await submit({ log: null, privateLogConsent: false, summary: 'Second synthetic report' });
  const client = maintainer();
  t.after(client.close);

  const listed = JSON.parse((await client.call('list_reports', {})).text);
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.countsByTriage, { new: 2, reviewed: 0, 'needs-info': 0, hidden: 0 });
  const filtered = JSON.parse((await client.call('list_reports', { platforms: ['steam-deck'], build: '93', has_log: 'attached', query: 'synthetic mcp' })).text);
  assert.deepEqual(filtered.reports.map((report: { id: string }) => report.id), [id]);
  assert.equal(JSON.parse((await client.call('list_reports', { has_log: 'none' })).text).reports[0].id, other);

  const report = JSON.parse((await client.call('get_report', { id })).text);
  assert.equal(report.summary, 'Synthetic MCP report');
  assert.equal(report.hasLog, true);

  const log = await client.call('get_report_log', { id });
  assert.equal(log.isError, false);
  assert.match(log.text, /4009 lines/);
  assert.match(log.text, /TRUNCATED: showing the first \d+ of 4009 lines \(max_bytes 65536\)/);
  assert.ok(Buffer.byteLength(log.text) < 66 * 1024);
  assert.match(log.text, /^   1 \| \[   0\.001001\] Frontend <Info>/m);
  const critical = await client.call('get_report_log', { id, levels: ['Critical'] });
  assert.match(critical.text, /1 matching the filter/);
  assert.match(critical.text, /^   9 \| .*VK_ERROR_DEVICE_LOST$/m);
  assert.doesNotMatch(critical.text, /TRUNCATED/);
  const searched = await client.call('get_report_log', { id, search: 'synthetic pipeline 3999', max_bytes: 2048 });
  assert.match(searched.text, /^4009 \| .*Synthetic pipeline 3999$/m);
  const whole = await client.call('get_report_log', { id, max_bytes: 524288 });
  assert.doesNotMatch(whole.text, /TRUNCATED/);
  assert.equal((await client.call('get_report_log', { id, max_bytes: 10 })).isError, true);
  assert.equal((await client.call('get_report_log', { id, levels: 'Error' })).isError, true);

  const triaged = JSON.parse((await client.call('update_triage', { id, triage: 'needs-info' })).text);
  assert.equal(triaged.triage, 'needs-info');
  const noted = JSON.parse((await client.call('update_triage', { id, internal_note: 'Synthetic note' })).text);
  assert.deepEqual([noted.triage, noted.internalNote], ['needs-info', 'Synthetic note']);
  await Promise.all([client.call('update_triage', { id, triage: 'hidden' }), client.call('update_triage', { id, internal_note: 'Parallel note' })]);
  const parallel = JSON.parse((await client.call('get_report', { id })).text);
  assert.deepEqual([parallel.triage, parallel.internalNote], ['hidden', 'Parallel note']);
  await client.call('update_triage', { id, triage: 'needs-info' });
  assert.equal((await client.call('update_triage', { id })).isError, true);
  assert.equal((await client.call('update_triage', { id, triage: 'deleted' })).isError, true);
  await client.call('update_triage', { id: other, triage: 'hidden' });
  assert.equal((await app.inject({ url: `/api/reports/${other}` })).statusCode, 404);

  const refused = await client.call('delete_report_log', { id, confirm: false });
  assert.equal(refused.isError, true);
  assert.equal(JSON.parse((await client.call('get_report', { id })).text).hasLog, true);
  const deleted = await client.call('delete_report_log', { id, confirm: true });
  assert.match(deleted.text, /Deleted the private log/);
  const gone = await client.call('get_report_log', { id });
  assert.equal(gone.isError, true);
  assert.match(gone.text, /HTTP 404: This log was not attached, was deleted, or has expired/);

  for (const name of ['get_report', 'get_report_log', 'update_triage', 'delete_report_log']) {
    const invalid = await client.call(name, { id: '../../api/games', confirm: true, triage: 'new' });
    assert.equal(invalid.isError, true, name);
    assert.match(invalid.text, /id must be a report UUID/);
  }
  const audit = await sql`SELECT DISTINCT actor FROM audit_events`;
  assert.deepEqual(audit.map(row => row.actor), ['api-token']);
  assert.equal(client.output().includes(token), false);
});

test('errors never echo the token and configuration problems fail safely', async () => {
  const wrongToken = randomBytes(32).toString('hex');
  const wrong = connect({ LICHII_BASE_URL: baseUrl, LICHII_MAINTAINER_TOKEN: wrongToken });
  const denied = await wrong.call('list_reports', {});
  assert.equal(denied.isError, true);
  assert.match(denied.text, /HTTP 401: The maintainer API token is not valid/);
  await wrong.close();
  assert.equal(wrong.output().includes(wrongToken), false);

  const missing = connect({ LICHII_BASE_URL: baseUrl });
  assert.match((await missing.call('get_report', { id: '00000000-0000-4000-8000-000000000000' })).text, /LICHII_MAINTAINER_TOKEN is not set/);
  await missing.close();

  const unreachable = connect({ LICHII_BASE_URL: 'http://127.0.0.1:9', LICHII_MAINTAINER_TOKEN: token });
  const offline = await unreachable.call('list_reports', {});
  assert.equal(offline.isError, true);
  assert.match(offline.text, /Could not reach http:\/\/127\.0\.0\.1:9/);
  await unreachable.close();
  assert.equal(unreachable.output().includes(token), false);

  for (const url of ['http://lichii.zortos.me', 'https://lichii.zortos.me/api', 'https://user:pass@lichii.zortos.me', 'not a url']) {
    const refused = connect({ LICHII_BASE_URL: url, LICHII_MAINTAINER_TOKEN: token });
    const [code] = await once(refused.child, 'exit');
    assert.equal(code, 1, url);
    assert.match(refused.output(), /LICHII_BASE_URL must/);
    assert.equal(refused.output().includes(token), false);
  }
});
