import { test, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import crypto, { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { hashToken, maintainerTokenMatches } from '../server/auth.ts';
import { prepareDatabase } from '../server/db.ts';
import { maintainerReportSchema, maintainerResponseSchema } from '../shared/domain.ts';
import { sourceLog, validSubmission } from './fixtures.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
const sql = postgres(databaseUrl, { connection: { search_path: 'maintainer_api' }, onnotice: () => {} });
const token = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(token).digest('hex');
const bearer = `Bearer ${token}`;
const env = { DATABASE_URL: databaseUrl, APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'maintainer-test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'maintainer-test-rate-secret'.repeat(3), NODE_ENV: 'test', TRUST_PROXY: 'true', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ALLOWED_ID: '65777760' };
const config = readConfig({ ...env, MAINTAINER_API_TOKEN_SHA256: tokenHash });
const app = await createApp(config, sql, false);
const disabled = await createApp(readConfig(env), sql, false);
const session = randomBytes(32).toString('hex');
let sequence = 1;
const ip = () => ({ 'x-real-ip': `198.18.${Math.floor(sequence / 250)}.${sequence++ % 250 + 1}` });
const withToken = (extra: Record<string, string> = {}) => ({ ...ip(), authorization: bearer, ...extra });
const json = { 'content-type': 'application/json' };
const randomBearer = () => `Bearer ${randomBytes(32).toString('hex')}`;

async function submit(change: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/reports', headers: { ...ip(), ...json, origin: config.APP_ORIGIN }, payload: { ...validSubmission, ...change } });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.json().id);
}
const triageOf = async (id: string) => (await sql`SELECT triage FROM reports WHERE id = ${id}`)[0]?.triage;

before(async () => {
  await sql`DROP SCHEMA IF EXISTS maintainer_api CASCADE`;
  await sql`CREATE SCHEMA maintainer_api`;
  await prepareDatabase(sql);
  await sql`INSERT INTO sessions(token_hash, github_id, github_login, expires_at) VALUES (${hashToken(session)}, '65777760', 'zortos293', now() + interval '1 hour')`;
  await Promise.all([app.ready(), disabled.ready()]);
});
after(async () => { await app.close(); await disabled.close(); await sql`DROP SCHEMA maintainer_api CASCADE`; await sql.end(); });

test('the token hash is optional, empty means disabled, and malformed hashes stop startup', () => {
  assert.equal(readConfig(env).MAINTAINER_API_TOKEN_SHA256, undefined);
  assert.equal(readConfig({ ...env, MAINTAINER_API_TOKEN_SHA256: '' }).MAINTAINER_API_TOKEN_SHA256, undefined);
  for (const value of [token.slice(0, 40), tokenHash.toUpperCase(), tokenHash.slice(1), `${tokenHash}0`, 'not-a-hash']) {
    assert.throws(() => readConfig({ ...env, MAINTAINER_API_TOKEN_SHA256: value }), /MAINTAINER_API_TOKEN_SHA256/);
  }
});

test('a valid token reads, triages and deletes logs on every maintainer route and audits as the token', async () => {
  const id = await submit();
  const list = await app.inject({ url: '/api/maintainer/reports', headers: withToken() });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.headers['cache-control'], 'no-store');
  assert.equal(maintainerResponseSchema.parse(list.json()).reports[0]?.id, id);
  const single = await app.inject({ url: `/api/maintainer/reports/${id}`, headers: withToken() });
  assert.equal(single.statusCode, 200);
  const report = maintainerReportSchema.parse(single.json());
  assert.equal(report.hasLog, true);
  assert.ok(report.logExpiresAt && new Date(report.logExpiresAt).getTime() > Date.now() + 89 * 86400000);
  const log = await app.inject({ url: `/api/maintainer/reports/${id}/log`, headers: withToken() });
  assert.equal(log.body, sourceLog);
  assert.equal(log.headers['cache-control'], 'no-store');
  const triage = await app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: withToken(json), payload: { triage: 'needs-info', internalNote: 'Asked for a second log' } });
  assert.equal(triage.statusCode, 200, triage.body);
  const deletion = await app.inject({ method: 'DELETE', url: `/api/maintainer/reports/${id}/log`, headers: withToken(json), payload: {} });
  assert.equal(deletion.statusCode, 204);
  const audit = await sql`SELECT actor, action FROM audit_events WHERE report_id = ${id} ORDER BY id`;
  assert.deepEqual(audit.map(row => [row.actor, row.action]), [['api-token', 'read-log'], ['api-token', 'triage'], ['api-token', 'delete-log']]);
  assert.equal(maintainerReportSchema.parse((await app.inject({ url: `/api/maintainer/reports/${id}`, headers: withToken() })).json()).logExpiresAt, null);
  assert.equal((await app.inject({ url: '/api/maintainer/reports/00000000-0000-4000-8000-000000000000', headers: withToken() })).statusCode, 404);
  const browserRead = await app.inject({ url: `/api/maintainer/reports/${id}`, headers: { ...ip(), cookie: `lichii-session=${session}` } });
  assert.equal(browserRead.statusCode, 200);
});

test('wrong and malformed tokens are refused before any data or mutation', async () => {
  const id = await submit({ log: null, privateLogConsent: false });
  for (const authorization of [randomBearer(), `Bearer ${tokenHash}`, `Basic ${token}`, `Bearer  ${token}`, `Bearer ${token} `, `Bearer ${token.slice(0, 31)}`, `Bearer ${token.repeat(5)}`, token, 'Bearer', '']) {
    const read = await app.inject({ url: '/api/maintainer/reports', headers: { ...ip(), authorization } });
    assert.equal(read.statusCode, 401, authorization);
    assert.equal(read.headers['www-authenticate'], 'Bearer');
    assert.equal(read.body.includes(token), false);
    const write = await app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: { ...ip(), ...json, authorization }, payload: { triage: 'hidden', internalNote: 'forged' } });
    assert.equal(write.statusCode, 403, authorization);
  }
  assert.equal(await triageOf(id), 'new');
  assert.equal((await sql`SELECT count(*)::int AS count FROM audit_events WHERE report_id = ${id}`)[0]?.count, 0);
});

test('the Bearer scheme is case-insensitive and triage updates are partial and atomic', async () => {
  const id = await submit({ log: null, privateLogConsent: false });
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...ip(), authorization: `bEaReR ${token}` } })).statusCode, 200);
  const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: withToken(json), payload });
  assert.equal((await patch({})).statusCode, 400);
  assert.equal((await patch({ triage: 'reviewed', internalNote: 'x', extra: true })).statusCode, 400);
  await Promise.all([patch({ triage: 'hidden' }), patch({ internalNote: 'Concurrent note' })]);
  const row = (await sql`SELECT triage, internal_note FROM reports WHERE id = ${id}`)[0];
  assert.deepEqual([row?.triage, row?.internal_note], ['hidden', 'Concurrent note']);
  assert.equal((await patch({ internalNote: '' })).statusCode, 200);
  assert.deepEqual(Object.values((await sql`SELECT triage, internal_note FROM reports WHERE id = ${id}`)[0] ?? {}), ['hidden', '']);
});

test('a token never combines with cookies or an Origin, even with a valid session', async () => {
  const id = await submit({ log: null, privateLogConsent: false });
  for (const extra of [{ cookie: `lichii-session=${session}` }, { cookie: 'unrelated=1' }, { origin: config.APP_ORIGIN }, { origin: 'https://evil.example' }] as Record<string, string>[]) {
    const read = await app.inject({ url: '/api/maintainer/reports', headers: withToken(extra) });
    assert.equal(read.statusCode, 400, JSON.stringify(extra));
    const write = await app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: withToken({ ...json, ...extra }), payload: { triage: 'hidden', internalNote: '' } });
    assert.equal(write.statusCode, extra.origin === config.APP_ORIGIN ? 400 : 403, JSON.stringify(extra));
  }
  assert.equal(await triageOf(id), 'new');
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...ip(), cookie: `lichii-session=${session}` } })).statusCode, 200);
  const cookieWithoutOrigin = await app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: { ...ip(), ...json, cookie: `lichii-session=${session}` }, payload: { triage: 'hidden', internalNote: '' } });
  assert.equal(cookieWithoutOrigin.statusCode, 403);
});

test('an unset hash disables token auth entirely', async () => {
  const id = await submit({ log: null, privateLogConsent: false });
  const read = await disabled.inject({ url: '/api/maintainer/reports', headers: withToken() });
  assert.equal(read.statusCode, 401);
  assert.match(read.json().error, /disabled/);
  assert.equal((await disabled.inject({ url: `/api/maintainer/reports/${id}`, headers: withToken() })).statusCode, 401);
  assert.equal((await disabled.inject({ url: `/api/maintainer/reports/${id}/log`, headers: withToken() })).statusCode, 401);
  for (const [method, url] of [['PATCH', `/api/maintainer/reports/${id}`], ['DELETE', `/api/maintainer/reports/${id}/log`]] as const) {
    assert.equal((await disabled.inject({ method, url, headers: withToken(json), payload: { triage: 'hidden', internalNote: '' } })).statusCode, 403, url);
  }
  assert.equal(await triageOf(id), 'new');
  assert.equal((await disabled.inject({ url: '/api/maintainer/reports', headers: { ...ip(), cookie: `lichii-session=${session}` } })).statusCode, 200);
});

test('tokens grant nothing on public, auth and native routes', async () => {
  const hidden = await submit({ log: null, privateLogConsent: false });
  await sql`UPDATE reports SET triage = 'hidden' WHERE id = ${hidden}`;
  const count = async () => (await sql`SELECT count(*)::int AS count FROM reports`)[0]?.count;
  const before = await count();
  for (const url of ['/api/reports', '/%61pi/reports', '/api/%72eports']) {
    assert.equal((await app.inject({ method: 'POST', url, headers: withToken(json), payload: validSubmission })).statusCode, 403, url);
  }
  const native = await app.inject({ method: 'POST', url: '/api/v1/desktop/reports', headers: withToken({ ...json, 'x-lichii-client': 'desktop/1', 'idempotency-key': crypto.randomUUID() }), payload: validSubmission });
  assert.equal(native.statusCode, 403);
  assert.match(native.json().error, /anonymous Lichii desktop/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: withToken(json), payload: {} })).statusCode, 403);
  for (const url of ['/api/maintainer/unknown', `/api/maintainer/reports/${hidden}/unknown`, `/api/reports/${hidden}`]) {
    assert.equal((await app.inject({ method: 'PATCH', url, headers: withToken(json), payload: {} })).statusCode, 403, url);
  }
  assert.equal(await count(), before);
  assert.equal((await app.inject({ url: `/api/reports/${hidden}`, headers: withToken() })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/auth/status', headers: withToken() })).json().authenticated, false);
});

test('encoded maintainer paths classify by the matched route for reads and writes', async () => {
  const id = await submit({ log: null, privateLogConsent: false });
  for (const url of ['/%61pi/maintainer/reports', '/a%70i/%6daintainer/reports', `/api/maintainer/%72eports/${id}`]) {
    const response = await app.inject({ url, headers: withToken() });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
    assert.equal((await disabled.inject({ url, headers: withToken() })).statusCode, 401, url);
  }
  const write = await app.inject({ method: 'PATCH', url: `/%61pi/%6daintainer/reports/${id}`, headers: withToken(json), payload: { triage: 'reviewed', internalNote: '' } });
  assert.equal(write.statusCode, 200, write.body);
  const wrong = await app.inject({ method: 'PATCH', url: `/%61pi/%6daintainer/reports/${id}`, headers: { ...ip(), ...json, authorization: randomBearer() }, payload: { triage: 'hidden', internalNote: '' } });
  assert.equal(wrong.statusCode, 403);
  assert.equal(await triageOf(id), 'reviewed');
});

test('token comparison hashes first and always uses a constant-time compare', t => {
  const compare = t.mock.method(crypto, 'timingSafeEqual');
  assert.equal(maintainerTokenMatches(bearer, tokenHash), true);
  assert.equal(maintainerTokenMatches(`Bearer ${'a'.repeat(32)}`, tokenHash), false);
  assert.equal(maintainerTokenMatches(`Bearer ${token.slice(0, 40)}`, tokenHash), false);
  assert.equal(compare.mock.callCount(), 3);
  for (const call of compare.mock.calls) {
    assert.equal((call.arguments[0] as Buffer).length, 32);
    assert.equal((call.arguments[1] as Buffer).length, 32);
  }
  assert.equal(maintainerTokenMatches(bearer, undefined), false);
  assert.equal(maintainerTokenMatches(undefined, tokenHash), false);
  assert.equal(compare.mock.callCount(), 3);
});

test('token requests have their own per-address limit', async () => {
  const stable = { 'x-real-ip': '198.19.0.77', authorization: bearer };
  for (let i = 0; i < 120; i++) assert.equal((await app.inject({ url: '/api/maintainer/reports?page=9999', headers: stable })).statusCode, 200);
  const limited = await app.inject({ url: '/api/maintainer/reports', headers: stable });
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { 'x-real-ip': '198.19.0.77', cookie: `lichii-session=${session}` } })).statusCode, 200);
});

test('failures never write the token or Authorization header to the server log', () => {
  const script = `
    const { createApp } = await import('./server/app.ts');
    const { readConfig } = await import('./server/config.ts');
    const config = readConfig(JSON.parse(process.env.CONFIG));
    const broken = () => ({ then: (_resolve, reject) => reject(new Error('database unavailable ' + process.env.BEARER)) });
    const app = await createApp(config, broken, false);
    const statuses = [];
    for (const url of ['/api/maintainer/reports', '/api/games', '/api/maintainer/reports/00000000-0000-4000-8000-000000000000/log']) {
      statuses.push((await app.inject({ url, headers: { authorization: process.env.BEARER, 'x-real-ip': '198.19.1.1' } })).statusCode);
    }
    await app.close();
    process.stderr.write(JSON.stringify(statuses));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, CONFIG: JSON.stringify({ ...env, MAINTAINER_API_TOKEN_SHA256: tokenHash }), BEARER: bearer },
  });
  assert.deepEqual(JSON.parse(child.stderr.trim().split('\n').at(-1) ?? ''), [500, 500, 500]);
  assert.match(child.stdout, /Request failed/);
  assert.doesNotMatch(child.stdout, new RegExp(`${token}|authorization|bearer|database unavailable`, 'i'));
});

test('the maintainer queue filters by triage, log, status, platform, build, game and text with totals per state', async () => {
  await sql`DELETE FROM reports`;
  const deck = await submit({ build: 'Lichii build-93', os: 'SteamOS 3.7', cpu: 'AMD Custom APU 0405', gpu: 'AMD Custom GPU 0405', outcome: 'Playable', summary: 'Deck plays it well' });
  const windows = await submit({ build: 'Build 92', os: 'Windows 11', gpu: 'NVIDIA GeForce RTX 4070', outcome: 'Runs', log: null, privateLogConsent: false });
  const linux = await submit({ gameId: 5483961, build: 'custom fork', os: 'CachyOS', gpu: 'AMD Radeon RX 7800 XT', outcome: 'Unplayable', name: 'Needle Reporter' });
  await sql`UPDATE reports SET triage = 'hidden' WHERE id = ${linux}`;
  await sql`UPDATE reports SET triage = 'needs-info' WHERE id = ${windows}`;
  const query = async (search: string) => maintainerResponseSchema.parse((await app.inject({ url: `/api/maintainer/reports?${search}`, headers: withToken() })).json());
  const all = await query('');
  assert.equal(all.total, 3);
  assert.deepEqual(all.counts, { new: 1, reviewed: 0, 'needs-info': 1, hidden: 1 });
  const idsFor = async (search: string) => (await query(search)).reports.map(report => report.id).sort();
  assert.deepEqual(await idsFor('triage=hidden'), [linux]);
  assert.deepEqual(await idsFor('log=none'), [windows]);
  assert.deepEqual(await idsFor('log=attached'), [deck, linux].sort());
  assert.deepEqual(await idsFor('platform=steam-deck'), [deck]);
  assert.deepEqual(await idsFor('platform=windows,linux'), [windows, linux].sort());
  assert.deepEqual(await idsFor('lichiiBuild=92'), [windows]);
  assert.deepEqual(await idsFor('lichiiBuild=other'), [linux]);
  assert.deepEqual(await idsFor('status=Playable'), [deck]);
  assert.deepEqual(await idsFor('gameId=5483961'), [linux]);
  assert.deepEqual(await idsFor('q=needle'), [linux]);
  assert.deepEqual(await idsFor(`q=${deck.slice(0, 8)}`), [deck]);
  assert.deepEqual(await idsFor('triage=new&platform=steam-deck&log=attached&lichiiBuild=93&status=Playable'), [deck]);
  assert.equal((await query('triage=reviewed')).total, 0);
  for (const search of ['triage=deleted', 'log=maybe', 'platform=playstation', 'lichiiBuild=build-93']) {
    assert.equal((await app.inject({ url: `/api/maintainer/reports?${search}`, headers: withToken() })).statusCode, 400, search);
  }
  assert.equal(maintainerReportSchema.parse((await app.inject({ url: `/api/maintainer/reports/${linux}`, headers: withToken() })).json()).triage, 'hidden');
});
