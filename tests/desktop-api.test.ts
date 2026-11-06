import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { prepareDatabase } from '../server/db.ts';
import { desktopSubmissionSchema } from '../shared/domain.ts';
import { validSubmission } from './fixtures.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
const sql = postgres(databaseUrl, { connection: { search_path: 'desktop_regression' }, onnotice: () => {} });
const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'desktop-test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'desktop-test-rate-secret'.repeat(3), NODE_ENV: 'test', TRUST_PROXY: 'true' });
const app = await createApp(config, sql, false);
const replica = await createApp(config, sql, false);
const url = '/api/v1/desktop/reports';
const { log, privateLogConsent, website, ...payload } = validSubmission;
let sequence = 1;
const headers = () => ({ 'content-type': 'application/json', 'x-lichii-client': 'desktop/1', 'idempotency-key': randomUUID(), 'x-real-ip': `192.0.2.${sequence++}` });

before(async () => {
  await sql`DROP SCHEMA IF EXISTS desktop_regression CASCADE`;
  await sql`CREATE SCHEMA desktop_regression`;
  await prepareDatabase(sql);
  await app.ready();
  await replica.ready();
});
after(async () => { await app.close(); await replica.close(); await sql`DROP SCHEMA desktop_regression CASCADE`; await sql.end(); });

test('native reports use the real catalog and public report storage without logs or hidden metadata', async () => {
  assert.equal(desktopSubmissionSchema.safeParse(payload).success, true);
  const response = await app.inject({ method: 'POST', url, headers: headers(), payload });
  assert.equal(response.statusCode, 201, response.body);
  const receipt = response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ['id', 'url']);
  assert.equal(receipt.url, `${config.APP_ORIGIN}/reports/${receipt.id}`);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  const rows = await sql`SELECT game_id, fields, desktop_submission_key, desktop_submission_hash FROM reports WHERE id = ${receipt.id}`;
  assert.equal(String(rows[0]?.game_id), String(payload.gameId));
  assert.equal(rows[0]?.fields.details, payload.details);
  assert.ok(rows[0]?.desktop_submission_key);
  assert.match(rows[0]?.desktop_submission_hash, /^[a-f0-9]{64}$/);
  assert.equal((await sql`SELECT * FROM private_logs`).length, 0);
  const publicResponse = await app.inject({ url: `/api/reports/${receipt.id}`, headers: headers() });
  assert.equal(publicResponse.statusCode, 200);
  for (const value of ['desktop_submission_key', 'desktop_submission_hash', 'publicConsent', 'safeFilesConsent', String(rows[0]?.desktop_submission_key)]) assert.equal(publicResponse.body.includes(value), false);
});

test('native boundary rejects browser metadata and credentials without weakening browser CSRF', async () => {
  for (const change of [{ 'x-lichii-client': '' }, { 'x-lichii-client': 'other-client' }, { origin: config.APP_ORIGIN }, { origin: 'null' }, { origin: 'https://evil.example' }, { cookie: 'session=synthetic' }, { authorization: 'Bearer synthetic' }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-dest': 'empty' }]) {
    const response = await app.inject({ method: 'POST', url, headers: { ...headers(), ...change }, payload });
    assert.equal(response.statusCode, 403, JSON.stringify(change));
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  for (const change of [{}, { origin: 'https://evil.example' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/reports', headers: { ...headers(), ...change }, payload: validSubmission });
    assert.equal(response.statusCode, 403);
  }
  const preflight = await app.inject({ method: 'OPTIONS', url, headers: { 'x-real-ip': '192.0.2.200', origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-lichii-client,idempotency-key,content-type' } });
  assert.equal(preflight.statusCode, 404);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  const encoded = await app.inject({ method: 'POST', url: '/%61pi/v1/%64esktop/reports', headers: { ...headers(), origin: config.APP_ORIGIN }, payload });
  assert.equal(encoded.statusCode, 403);
});

test('native schema requires review and consent and rejects logs, private fields and invalid reports', async () => {
  const before = await sql`SELECT count(*)::int AS count FROM reports`;
  for (const change of [{ publicConsent: false }, { publicConsent: undefined }, { safeFilesConsent: false }, { safeFilesConsent: undefined }, { name: '' }, { name: 'x'.repeat(61) }, { gameId: 999999999 }, { gameId: 1.5 }, { outcome: 'Untested' }, { graphicsApi: 'Automatic' }, { handle: 'https://evil.example' }, { details: 'bad\u0000text' }, { log: validSubmission.log }, { privateLogConsent: true }, { website: '' }, { title: 'Spoofed game' }, { performance: { averageFps: 60 } }, { internalNote: 'PRIVATE_NATIVE_SENTINEL' }]) {
    const response = await app.inject({ method: 'POST', url, headers: headers(), payload: { ...payload, ...change } });
    assert.equal(response.statusCode, 400, JSON.stringify(change));
    assert.doesNotMatch(response.body, /PRIVATE_NATIVE_SENTINEL/);
  }
  const badKey = await app.inject({ method: 'POST', url, headers: { ...headers(), 'idempotency-key': 'not-a-uuid' }, payload });
  assert.equal(badKey.statusCode, 400);
  assert.ok(badKey.json().fields['idempotency-key']);
  const { 'idempotency-key': unused, ...withoutKey } = headers();
  assert.equal((await app.inject({ method: 'POST', url, headers: withoutKey, payload })).statusCode, 400);
  const after = await sql`SELECT count(*)::int AS count FROM reports`;
  assert.equal(after[0]?.count, before[0]?.count);
});

test('native requests enforce JSON, the smaller body limit and trusted Railway addresses', async () => {
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers(), 'content-type': 'text/plain' }, payload: 'text' })).statusCode, 415);
  assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: { ...payload, details: 'x'.repeat(129 * 1024) } })).statusCode, 413);
  const { 'x-real-ip': unused, ...withoutIp } = headers();
  assert.equal((await app.inject({ method: 'POST', url, headers: withoutIp, payload })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers(), 'x-real-ip': '1.1.1.1, 8.8.8.8' }, payload })).statusCode, 400);
});

test('native and browser reports share one IP quota even through encoded URLs and spoofed forwarding', async () => {
  const stable = { ...headers(), 'x-real-ip': '198.51.100.191' };
  for (let i = 0; i < 5; i++) {
    const response = await app.inject({ method: 'POST', url: i < 3 ? '/api/reports' : url, headers: { ...stable, 'x-forwarded-for': `203.0.113.${i + 1}`, ...(i < 3 ? { origin: config.APP_ORIGIN } : {}) }, payload: i < 3 ? { ...validSubmission, name: '' } : { ...payload, name: '' } });
    assert.equal(response.statusCode, 400);
  }
  for (const target of [url, '/%61pi/v1/%64esktop/reports', '/api/reports']) {
    const response = await app.inject({ method: 'POST', url: target, headers: { ...stable, ...(target === '/api/reports' ? { origin: config.APP_ORIGIN } : {}) }, payload: target === '/api/reports' ? validSubmission : payload });
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers['retry-after']) > 0);
  }
});

test('unchanged native retries return one receipt and changed bodies conflict without extra global slots', async () => {
  const stable = headers();
  const day = Math.floor(Date.now() / 86400000);
  const count = async () => Number((await sql`SELECT count FROM rate_limits WHERE key = ${`global-submit:${day}`}`)[0]?.count ?? 0);
  const before = await count();
  const first = await app.inject({ method: 'POST', url, headers: stable, payload });
  assert.equal(first.statusCode, 201);
  const retry = await app.inject({ method: 'POST', url, headers: stable, payload: { ...payload, name: `  ${payload.name}  `, handle: undefined, ram: undefined, reproduction: undefined, updates: undefined, mods: undefined } });
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json(), first.json());
  const conflict = await app.inject({ method: 'POST', url, headers: stable, payload: { ...payload, details: 'Edited report text' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(await count(), before + 1);
  assert.equal((await sql`SELECT id FROM reports WHERE desktop_submission_key = ${stable['idempotency-key']}`).length, 1);
});

test('concurrent retries across app instances create one report atomically', async () => {
  const key = randomUUID();
  const responses = await Promise.all([app, replica, app].map(instance => instance.inject({ method: 'POST', url, headers: { ...headers(), 'idempotency-key': key }, payload })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 200, 201]);
  assert.ok(responses.every(response => response.body === responses[0]?.body));
  assert.equal((await sql`SELECT id FROM reports WHERE desktop_submission_key = ${key}`).length, 1);
});

test('global quota blocks new native and browser reports but preserves an existing receipt', async t => {
  const stable = headers();
  const first = await app.inject({ method: 'POST', url, headers: stable, payload });
  assert.equal(first.statusCode, 201);
  const key = `global-submit:${Math.floor(Date.now() / 86400000)}`;
  const previous = await sql`SELECT count FROM rate_limits WHERE key = ${key}`;
  t.after(async () => { await sql`UPDATE rate_limits SET count = ${previous[0]?.count} WHERE key = ${key}`; });
  await sql`UPDATE rate_limits SET count = 1000 WHERE key = ${key}`;
  for (const target of [url, '/api/reports']) {
    const response = await app.inject({ method: 'POST', url: target, headers: { ...headers(), ...(target === '/api/reports' ? { origin: config.APP_ORIGIN } : {}) }, payload: target === '/api/reports' ? validSubmission : payload });
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers['retry-after']) > 0);
  }
  const retry = await app.inject({ method: 'POST', url, headers: stable, payload });
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json(), first.json());
});

test('migration upgrades v1 without replacing reports and remains safe across restarts', async t => {
  const upgrade = postgres(databaseUrl, { connection: { search_path: 'desktop_upgrade_regression' }, onnotice: () => {} });
  t.after(async () => { await upgrade`DROP SCHEMA IF EXISTS desktop_upgrade_regression CASCADE`; await upgrade.end(); });
  await upgrade`DROP SCHEMA IF EXISTS desktop_upgrade_regression CASCADE`;
  await upgrade`CREATE SCHEMA desktop_upgrade_regression`;
  await upgrade.unsafe(await readFile(new URL('../server/migrations/001-initial.sql', import.meta.url), 'utf8'));
  await upgrade`CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  await upgrade`INSERT INTO schema_migrations(version) VALUES (1)`;
  const game = (await sql`SELECT * FROM games WHERE sgdb_id = ${payload.gameId}`)[0];
  assert.ok(game);
  await upgrade`INSERT INTO games(sgdb_id, slug, title, catalog) VALUES (${game.sgdb_id}, ${game.slug}, ${game.title}, ${upgrade.json(game.catalog)})`;
  const id = randomUUID();
  const { publicConsent, safeFilesConsent, ...fields } = payload;
  await upgrade`INSERT INTO reports(id, game_id, fields) VALUES (${id}, ${fields.gameId}, ${upgrade.json(fields)})`;
  await Promise.all([prepareDatabase(upgrade), prepareDatabase(upgrade)]);
  await prepareDatabase(upgrade);
  const stored = (await upgrade`SELECT * FROM reports WHERE id = ${id}`)[0];
  assert.equal(stored?.fields.details, fields.details);
  assert.equal(stored?.desktop_submission_key, null);
  assert.equal(stored?.desktop_submission_hash, null);
  assert.deepEqual((await upgrade`SELECT version FROM schema_migrations ORDER BY version`).map(row => row.version), [1, 2]);
});
