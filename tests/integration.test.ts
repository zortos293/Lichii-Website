import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connectDatabase, prepareDatabase, cleanup } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { hashToken } from '../server/auth.ts';
import { z } from 'zod';
import { summaryResponseSchema } from '../shared/domain.ts';
import { validSubmission, sourceLog } from './fixtures.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('/lichii_test')) throw new Error('Set TEST_DATABASE_URL to an isolated PostgreSQL database named lichii_test. Tests delete that database schema.');
const sql = connectDatabase(databaseUrl);
const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'test-rate-limit-secret'.repeat(3), NODE_ENV: 'test', TRUST_PROXY: 'true', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ALLOWED_ID: '65777760' });
const app = await createApp(config, sql, false);
let sequence = 1;
const headers = () => ({ origin: config.APP_ORIGIN, 'content-type': 'application/json', 'x-real-ip': `198.51.${Math.floor(sequence / 250)}.${sequence++ % 250 + 1}` });
const token = randomBytes(32).toString('hex');
const cookie = `lichii-session=${token}`;

before(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await prepareDatabase(sql);
  await app.ready();
});
after(async () => { await app.close(); await sql.end(); });

test('CSP permits only the exact Databuddy script and ingestion origins', async () => {
  const response = await app.inject({ url: '/api/health' });
  const policy = response.headers['content-security-policy'];
  assert.ok(typeof policy === 'string');
  const directives = policy.split(';').map(value => value.trim());
  assert.ok(directives.includes("script-src 'self' https://cdn.databuddy.cc"));
  assert.ok(directives.includes("connect-src 'self' https://basket.databuddy.cc"));
  for (const directive of ['style-src', 'img-src', 'font-src']) assert.ok(directives.includes(`${directive} 'self'`));
  assert.equal(policy.includes('*'), false);
});

test('real PostgreSQL migrations/import are concurrent-safe, idempotent and seed zero reports', async () => {
  await Promise.all([prepareDatabase(sql), prepareDatabase(sql)]);
  const response = await app.inject({ method: 'GET', url: '/api/games', headers: headers() });
  assert.equal(response.statusCode, 200);
  const data = response.json();
  const catalogSize = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8')).length;
  assert.equal(data.totalGames, catalogSize); assert.equal(data.totalReports, 0); assert.equal(data.counts.Untested, catalogSize);
  assert.equal(data.games.length, 15); assert.equal(data.pageCount, Math.ceil(catalogSize / 15));
  assert.ok(data.games.every((g: { status: string; reportCount: number }) => g.status === 'Untested' && g.reportCount === 0));
  assert.deepEqual((await sql`SELECT version FROM schema_migrations ORDER BY version`).map(row => row.version), [1, 2]);
  const filtered = await app.inject({ url: '/api/games?q=Mario%20Kart%20World&status=Untested', headers: headers() });
  assert.equal(filtered.json().total, 1);
  const attack = await app.inject({ url: "/api/games?q='OR%201=1--", headers: headers() });
  assert.equal(attack.json().total, 0);
  assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200);
});

test('anonymous submissions persist but public APIs never expose log contents, filenames or notes', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/reports', headers: headers(), payload: validSubmission });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().id;
  const publicResponse = await app.inject({ url: `/api/reports/${id}`, headers: headers() });
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(publicResponse.json().name, validSubmission.name);
  assert.equal(publicResponse.json().outcome, 'Runs');
  for (const secret of ['eden_log.txt', 'development-test-build', 'privateLogConsent', 'hasLog', 'internalNote']) assert.equal(publicResponse.body.includes(secret), false);
  const logs = await sql`SELECT content, expires_at FROM private_logs WHERE report_id = ${id}`;
  assert.equal(logs[0]?.content.toString('utf8'), sourceLog);
  const aggregate = await app.inject({ url: '/api/games?q=Mario%20Kart%20World', headers: headers() });
  assert.equal(aggregate.json().games[0].reportCount, 1); assert.equal(aggregate.json().games[0].status, 'Runs');
  await sql`DELETE FROM reports WHERE id = ${id}`;
});

test('malicious uploads, invalid forms, CSRF, request size and wrong MIME are rejected before storage', async () => {
  for (const change of [{ log: { ...validSubmission.log, text: `${sourceLog}<script>alert(1)</script>` } }, { log: { ...validSubmission.log, text: `${sourceLog}\u0000PK` } }, { log: { ...validSubmission.log, name: 'firmware.zip' } }, { log: { ...validSubmission.log, mime: 'image/svg+xml' } }, { name: '' }, { outcome: 'Untested' }, { gameId: 999999999 }, { publicConsent: false }]) {
    const response = await app.inject({ method: 'POST', url: '/api/reports', headers: headers(), payload: { ...validSubmission, ...change } });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/reports', headers: { ...headers(), origin: 'https://evil.example' }, payload: validSubmission })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/reports', headers: { ...headers(), 'content-type': 'text/plain' }, payload: 'attack' })).statusCode, 415);
  assert.equal((await app.inject({ method: 'POST', url: '/api/reports', headers: headers(), payload: JSON.stringify({ ...validSubmission, details: 'x'.repeat(1200 * 1024) }) })).statusCode, 413);
  assert.equal((await sql`SELECT * FROM reports`).length, 0);
});

test('all privileged endpoints reject anonymous, forged, expired and non-allowlisted sessions', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [method, url] of [['GET', '/api/maintainer/reports'], ['GET', `/api/maintainer/reports/${id}`], ['GET', `/api/maintainer/reports/${id}/log`], ['PATCH', `/api/maintainer/reports/${id}`], ['DELETE', `/api/maintainer/reports/${id}/log`]] satisfies ['GET' | 'PATCH' | 'DELETE', string][]) {
    const response = await app.inject({ method, url, headers: headers(), ...(method !== 'GET' ? { payload: {} } : {}) });
    assert.equal(response.statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie: 'lichii-session=forged' } })).statusCode, 401);
  await sql`INSERT INTO sessions(token_hash, github_id, github_login, expires_at) VALUES (${hashToken(token)}, '123', 'zortos293', now() + interval '1 hour')`;
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie } })).statusCode, 403);
  await sql`UPDATE sessions SET github_id = '65777760', github_login = 'other'`;
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie } })).statusCode, 403);
  await sql`UPDATE sessions SET github_login = 'zortos293', expires_at = now() - interval '1 second'`;
  assert.equal((await app.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie } })).statusCode, 403);
  const disabled = await createApp({ ...config, GITHUB_CLIENT_SECRET: undefined }, sql, false);
  assert.equal((await disabled.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie } })).statusCode, 503);
  await disabled.close();
});

test('OAuth state and PKCE protect the callback and redirect destinations are fixed', async () => {
  const start = await app.inject({ url: '/api/auth/login?redirect=https://evil.example', headers: headers() });
  assert.equal(start.statusCode, 302);
  const url = new URL(String(start.headers.location));
  assert.equal(url.origin, 'https://github.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `${config.APP_ORIGIN}/api/auth/callback`);
  assert.ok(url.searchParams.get('code_challenge')); assert.ok(url.searchParams.get('state'));
  const setCookie = String(start.headers['set-cookie']);
  assert.ok(setCookie.includes('HttpOnly')); assert.ok(setCookie.includes('SameSite=Lax'));
  const missing = await app.inject({ url: '/api/auth/callback?code=fake&state=fake', headers: headers() });
  assert.equal(missing.headers.location, '/maintainer?error=sign-in-failed');
  const mismatch = await app.inject({ url: '/api/auth/callback?code=fake&state=wrong', headers: { ...headers(), cookie: setCookie.split(';')[0] } });
  assert.equal(mismatch.headers.location, '/maintainer?error=sign-in-failed');
  assert.equal((await sql`SELECT * FROM sessions WHERE expires_at > now()`).length, 0);
});

test('authorized triage, private download, audit, hiding, deletion and retention operate on real rows', async () => {
  await sql`UPDATE sessions SET github_id = '65777760', github_login = 'zortos293', expires_at = now() + interval '1 hour' WHERE token_hash = ${hashToken(token)}`;
  const response = await app.inject({ method: 'POST', url: '/api/reports', headers: headers(), payload: validSubmission });
  const id = response.json().id;
  const queue = await app.inject({ url: '/api/maintainer/reports', headers: { ...headers(), cookie } });
  assert.equal(queue.statusCode, 200); assert.equal(queue.json().reports[0].hasLog, true);
  const log = await app.inject({ url: `/api/maintainer/reports/${id}/log`, headers: { ...headers(), cookie } });
  assert.equal(log.body, sourceLog); assert.equal(log.headers['content-disposition'], 'attachment; filename="eden_log.txt"');
  assert.equal(log.headers['cache-control'], 'no-store'); assert.equal(log.headers['x-content-type-options'], 'nosniff');
  const update = await app.inject({ method: 'PATCH', url: `/api/maintainer/reports/${id}`, headers: { ...headers(), cookie }, payload: { triage: 'hidden', internalNote: 'PRIVATE INTERNAL NOTE' } });
  assert.equal(update.statusCode, 200);
  assert.equal((await app.inject({ url: `/api/reports/${id}`, headers: headers() })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/games?q=Mario%20Kart%20World', headers: headers() })).json().games[0].status, 'Untested');
  const audit = await sql`SELECT action FROM audit_events WHERE report_id = ${id} ORDER BY id`;
  assert.deepEqual(audit.map(row => row.action), ['read-log', 'triage']);
  await sql`UPDATE private_logs SET expires_at = now() - interval '1 second' WHERE report_id = ${id}`;
  assert.equal((await app.inject({ url: `/api/maintainer/reports/${id}/log`, headers: { ...headers(), cookie } })).statusCode, 404);
  await cleanup(sql); assert.equal((await sql`SELECT * FROM private_logs`).length, 0);
  await sql`INSERT INTO private_logs(report_id, content) VALUES (${id}, ${Buffer.from(sourceLog)})`;
  const deletion = await app.inject({ method: 'DELETE', url: `/api/maintainer/reports/${id}/log`, headers: { ...headers(), cookie }, payload: {} });
  assert.equal(deletion.statusCode, 204); assert.equal((await sql`SELECT * FROM private_logs`).length, 0);
  await sql`DELETE FROM reports WHERE id = ${id}`;
});

test('durable limits trust only valid Railway X-Real-IP and ignore spoofed forwarded chains', async () => {
  const stable = { ...headers(), 'x-real-ip': '203.0.113.40' };
  for (let i = 0; i < 5; i++) {
    const response = await app.inject({ method: 'POST', url: '/api/reports', headers: { ...stable, 'x-forwarded-for': `1.1.1.${i}` }, payload: { ...validSubmission, name: '' } });
    assert.equal(response.statusCode, 400);
  }
  const limited = await app.inject({ method: 'POST', url: '/api/reports', headers: { ...stable, 'x-forwarded-for': '8.8.8.8' }, payload: validSubmission });
  assert.equal(limited.statusCode, 429);
  assert.equal((await app.inject({ url: '/api/games', headers: { 'x-forwarded-for': '8.8.8.8' } })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/games', headers: { 'x-real-ip': '8.8.8.8, 1.1.1.1' } })).statusCode, 400);
  const local = await createApp({ ...config, TRUST_PROXY: 'false' }, sql, false);
  for (let i = 0; i < 6; i++) {
    const response = await local.inject({ method: 'POST', url: '/api/reports', headers: { ...headers(), 'x-forwarded-for': `1.1.1.${i}` }, remoteAddress: '192.0.2.72', payload: { ...validSubmission, name: '' } });
    assert.equal(response.statusCode, i === 5 ? 429 : 400);
  }
  await local.close();
});

test('encoded API paths cannot bypass trusted proxy validation or private response cache protection', async () => {
  for (const url of ['/api/games', '/%61pi/games', '/a%70i/%67ames']) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
  }
  for (const url of ['/api/maintainer/reports', '/%61pi/maintainer/reports', '/a%70i/%6daintainer/reports']) {
    const response = await app.inject({ url, headers: headers() });
    assert.equal(response.statusCode, 401, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
  }
});

test('report submission limits cannot be bypassed by encoding the API prefix or endpoint', async () => {
  const stable = { ...headers(), 'x-real-ip': '203.0.113.171' };
  for (let i = 0; i < 5; i++) {
    const response = await app.inject({ method: 'POST', url: '/api/reports', headers: stable, payload: { ...validSubmission, name: '' } });
    assert.equal(response.statusCode, 400);
  }
  for (const url of ['/api/reports', '/api/%72eports', '/%61pi/reports', '/%61pi/%72eports', '/api/reports?source=test']) {
    const response = await app.inject({ method: 'POST', url, headers: stable, payload: { ...validSubmission, name: '' } });
    assert.equal(response.statusCode, 429, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
  }
});

test('private API responses stay uncacheable through encoded routes with or without a valid session', async t => {
  const privateToken = randomBytes(32).toString('hex');
  await sql`INSERT INTO sessions(token_hash, github_id, github_login, expires_at) VALUES (${hashToken(privateToken)}, '65777760', 'zortos293', now() + interval '1 hour')`;
  t.after(async () => { await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(privateToken)}`; });
  for (const signedIn of [false, true]) {
    for (const url of ['/api/maintainer/reports', '/%61pi/maintainer/reports', '/%61pi/%6daintainer/reports']) {
      const response = await app.inject({ url, headers: { ...headers(), ...(signedIn ? { cookie: `lichii-session=${privateToken}` } : {}) } });
      assert.equal(response.statusCode, signedIn ? 200 : 401, url);
      assert.equal(response.headers['cache-control'], 'no-store', url);
    }
  }
});

test('OAuth attempt limits cannot be bypassed by encoding the API prefix or endpoint', async () => {
  const stable = { ...headers(), 'x-real-ip': '203.0.113.172' };
  for (let i = 0; i < 20; i++) {
    const response = await app.inject({ url: '/api/auth/login', headers: stable });
    assert.equal(response.statusCode, 302);
  }
  const before = await sql`SELECT count(*)::int AS count FROM oauth_attempts`;
  for (const url of ['/api/auth/login', '/api/auth/%6cogin', '/%61pi/auth/login', '/%61pi/auth/%6cogin']) {
    const response = await app.inject({ url, headers: stable });
    assert.equal(response.statusCode, 429, url);
    assert.equal(response.headers['set-cookie'], undefined, url);
  }
  const after = await sql`SELECT count(*)::int AS count FROM oauth_attempts`;
  assert.equal(after[0]?.count, before[0]?.count);
});

test('platform toggles, build sections, median and playable share are derived read-only from report fields', async t => {
  const submit = async (change: Partial<typeof validSubmission>) => {
    const response = await app.inject({ method: 'POST', url: '/api/reports', headers: headers(), payload: { ...validSubmission, log: null, privateLogConsent: false, ...change } });
    assert.equal(response.statusCode, 201, response.body);
    return z.object({ id: z.uuid() }).parse(response.json()).id;
  };
  const ids: string[] = [];
  ids.push(await submit({ build: 'Lichii build-93 (09b78bd2dfdd)', os: 'Windows 11 Version 26H2', gpu: 'NVIDIA GeForce RTX 4070', outcome: 'Playable' }));
  ids.push(await submit({ build: 'Build 92', os: 'SteamOS 3.7', cpu: 'AMD Custom APU 0405', gpu: 'AMD Custom GPU 0405', outcome: 'Runs' }));
  ids.push(await submit({ build: '93', os: 'CachyOS', gpu: 'AMD Radeon RX 7800 XT (RADV NAVI32)', outcome: 'Unplayable' }));
  ids.push(await submit({ build: 'custom-fork-1973c1df56', os: 'macOS', cpu: 'Apple M3', gpu: 'Apple M3', outcome: 'Perfect' }));
  ids.push(await submit({ gameId: 5483961, build: 'nx2-build-93', os: 'Win 11', gpu: 'RX 9070 XT', outcome: 'Loads' }));
  t.after(async () => { await sql`DELETE FROM reports WHERE id IN ${sql(ids)}`; });

  const games = (await app.inject({ url: '/api/games?q=Mario%20Kart%20World', headers: headers() })).json();
  const mario = games.games[0];
  assert.equal(mario.reportCount, 4); assert.equal(mario.status, 'Perfect'); assert.equal(mario.median, 'Runs');
  assert.deepEqual(mario.best, { outcome: 'Perfect', setup: 'Apple M3 · Vulkan · macOS' });
  assert.deepEqual(mario.recentBuilds.map((entry: { build: number }) => entry.build), [86, 87, 88, 89, 90, 91, 92, 93]);
  assert.deepEqual(mario.recentBuilds.slice(-3).map((entry: { status: string }) => entry.status), ['Untested', 'Runs', 'Playable']);
  assert.equal(games.latestBuild, 93); assert.equal(games.totalReports, 5); assert.equal(games.counts.Perfect, 1); assert.equal(games.counts.Loads, 1);

  const deck = (await app.inject({ url: '/api/games?platform=steam-deck', headers: headers() })).json();
  assert.equal(deck.total, 1); assert.equal(deck.games[0].sgdbId, 5483943); assert.equal(deck.games[0].reportCount, 1); assert.equal(deck.games[0].status, 'Runs');
  const other = (await app.inject({ url: '/api/games?lichiiBuild=other', headers: headers() })).json();
  assert.equal(other.total, 1); assert.equal(other.games[0].status, 'Perfect');
  const both = (await app.inject({ url: '/api/games?platform=windows,linux&lichiiBuild=93', headers: headers() })).json();
  assert.deepEqual(both.games.map((game: { sgdbId: number; reportCount: number }) => [game.sgdbId, game.reportCount]), [[5483943, 2], [5483961, 1]]);
  for (const url of ['/api/games?platform=playstation', '/api/reports?lichiiBuild=build-93', '/api/summary?platform=%27OR%201=1--']) assert.equal((await app.inject({ url, headers: headers() })).statusCode, 400, url);

  const summary = summaryResponseSchema.parse((await app.inject({ url: '/api/summary', headers: headers() })).json());
  assert.deepEqual(summary.overall, { total: 5, counts: { Perfect: 1, Playable: 1, Runs: 1, Loads: 1, Unplayable: 1 }, playable: 2, median: 'Runs' });
  assert.deepEqual(summary.platforms.map(entry => [entry.platform, entry.total, entry.playable, entry.median]), [['steam-deck', 1, 0, 'Runs'], ['windows', 2, 1, 'Loads'], ['linux', 1, 0, 'Unplayable'], ['macos', 1, 1, 'Perfect']]);
  assert.deepEqual(summary.builds.map(entry => [entry.build, entry.total, entry.games, entry.median]), [[93, 3, 2, 'Loads'], [92, 1, 1, 'Runs'], [null, 1, 1, 'Perfect']]);
  assert.equal(summary.latestBuild, 93); assert.equal(summary.gamesTested, 2);
  assert.equal(summaryResponseSchema.parse((await app.inject({ url: '/api/summary?gameId=5483961', headers: headers() })).json()).overall.total, 1);

  const count = async (query: string) => (await app.inject({ url: `/api/reports?${query}`, headers: headers() })).json().total;
  assert.equal(await count('platform=steam-deck'), 1); assert.equal(await count('lichiiBuild=93'), 3); assert.equal(await count('lichiiBuild=other'), 1);
  assert.equal(await count('platform=windows&lichiiBuild=93'), 2); assert.equal(await count('platform=windows&lichiiBuild=93&status=Loads'), 1);
  assert.equal(await count('platform=macos&gameId=5483961'), 0);
  const page = (await app.inject({ url: '/api/reports?platform=steam-deck', headers: headers() })).json();
  assert.equal(page.reports[0].id, ids[1]); assert.equal(page.reports[0].gameCoverPath, '/art/5483943-cover.webp');

  await sql`UPDATE reports SET triage = 'hidden' WHERE id = ${ids[3] ?? ''}`;
  assert.equal(summaryResponseSchema.parse((await app.inject({ url: '/api/summary', headers: headers() })).json()).overall.total, 4);
  assert.equal((await app.inject({ url: '/api/games?lichiiBuild=other', headers: headers() })).json().total, 0);
});

test('the desktop catalog search keeps its response contract', async () => {
  const response = await app.inject({ url: '/api/games?q=Mario&page=1&sort=title', headers: headers() });
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.equal(data.page, 1); assert.ok(data.pageCount >= 1 && data.pageCount <= 10000); assert.ok(Array.isArray(data.games) && data.games.length <= 15);
  for (const key of ['games', 'page', 'pageCount', 'total', 'totalGames', 'totalReports', 'counts']) assert.ok(key in data, key);
  for (const game of data.games) {
    assert.ok(Number.isSafeInteger(game.sgdbId) && game.sgdbId > 0); assert.equal(typeof game.slug, 'string'); assert.ok(game.title.trim());
    for (const key of ['reportCount', 'status', 'latestAt', 'coverPath', 'publisher']) assert.ok(key in game, key);
  }
  const titles = data.games.map((game: { title: string }) => game.title.toLowerCase());
  assert.deepEqual(titles, [...titles].sort());
  assert.equal((await app.inject({ url: '/api/games?q=Mario&page=2&sort=title', headers: headers() })).json().page, 2);
});
