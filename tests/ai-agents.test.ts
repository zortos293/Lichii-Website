import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
import type { LightMyRequestResponse } from 'fastify';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { prepareDatabase } from '../server/db.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
if (!existsSync(new URL('../dist/index.html', import.meta.url))) throw new Error('Run npm run build first: these tests cover the static files and SPA fallback.');
const sql = postgres(databaseUrl, { connection: { search_path: 'agent_tracking' }, onnotice: () => {} });
const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: 'https://lichii.example', COOKIE_SECRET: 'agent-test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'agent-test-rate-secret'.repeat(3), NODE_ENV: 'test' });
type Reporter = NonNullable<Parameters<typeof createApp>[3]>;
type AgentRequest = Parameters<Reporter>[0];
const seen: AgentRequest[] = [];
const app = await createApp(config, sql);
const untracked = await createApp(config, sql, true, async () => {});
const recording = await createApp(config, sql, true, async request => { seen.push(request); });
const rejecting = await createApp(config, sql, true, () => Promise.reject(new Error('Databuddy is down')));
const hanging = await createApp(config, sql, true, () => new Promise<void>(() => {}));
const apps = [app, untracked, recording, rejecting, hanging];

const gptBot = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.3; +https://openai.com/gptbot)';
const claudeBot = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const secrets = { cookie: 'lichii-session=secret-session-token', authorization: 'Bearer secret-token', 'x-forwarded-host': 'evil.example', 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' };
const paths = [
  { url: '/guide.md?token=secret', path: '/guide.md', status: 404, format: 'markdown' },
  { url: '/fonts/OFL.txt', path: '/fonts/OFL.txt', status: 200, format: 'html' },
  { url: '/llms.txt', path: '/llms.txt', status: 404, format: 'llms' },
  { url: '/llms-full.txt', path: '/llms-full.txt', status: 404, format: 'llms' },
  { url: '/', path: '/', status: 200, format: 'html' },
  { url: '/games/mario-kart-world', path: '/games/mario-kart-world', status: 200, format: 'html' },
  { url: '/api/not-a-route', path: '/api/not-a-route', status: 404, format: 'html' },
];

function stubDatabuddy(t: TestContext, respond: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return respond();
  });
  return calls;
}

function snapshot(response: LightMyRequestResponse) {
  const { date, ...headers } = response.headers;
  return { status: response.statusCode, headers, body: response.body };
}

before(async () => {
  await sql`DROP SCHEMA IF EXISTS agent_tracking CASCADE`;
  await sql`CREATE SCHEMA agent_tracking`;
  await prepareDatabase(sql);
  await Promise.all(apps.map(instance => instance.ready()));
});
after(async () => {
  await Promise.all(apps.map(instance => instance.close()));
  await sql`DROP SCHEMA agent_tracking CASCADE`;
  await sql.end();
});

test('AI crawlers report each markdown, text, llms.txt, static, SPA and 404 read once with the website ID', async t => {
  const calls = stubDatabuddy(t);
  for (const userAgent of [gptBot, claudeBot]) {
    for (const { url, path, status, format } of paths) {
      const previous = calls.length;
      const response = await app.inject({ url, headers: { 'user-agent': userAgent, accept: '*/*', ...secrets } });
      assert.equal(response.statusCode, status, url);
      assert.equal(calls.length, previous + 1, url);
      assert.deepEqual(calls.at(-1), { url: 'https://basket.databuddy.cc/ai-traffic', body: { accept: '*/*', format, host: 'lichii.example', path, userAgent, websiteId: 'da37ce88-b18d-4639-a886-b2e74119b0ad' } }, url);
    }
  }
});

test('markdown-first clients and signed agent browsers are recorded with only the SDK fields', async t => {
  const calls = stubDatabuddy(t);
  await app.inject({ url: '/reports', headers: { 'user-agent': 'docs-fetcher/1.0', accept: 'text/markdown, text/html;q=0.5', ...secrets } });
  await app.inject({ method: 'HEAD', url: '/guide', headers: { 'user-agent': chrome, 'signature-agent': '"https://chatgpt.com"', referer: 'https://chatgpt.com/', 'sec-fetch-mode': 'navigate', ...secrets } });
  assert.deepEqual(calls.map(call => call.body), [
    { accept: 'text/markdown, text/html;q=0.5', format: 'markdown', host: 'lichii.example', path: '/reports', userAgent: 'docs-fetcher/1.0', websiteId: config.DATABUDDY_WEBSITE_ID },
    { format: 'html', host: 'lichii.example', path: '/guide', referrer: 'https://chatgpt.com/', signatureAgent: '"https://chatgpt.com"', userAgent: chrome, websiteId: config.DATABUDDY_WEBSITE_ID },
  ]);
  for (const call of calls) for (const secret of Object.values(secrets)) assert.equal(JSON.stringify(call.body).includes(secret), false, secret);
});

test('the tracker receives only allowlisted headers and never cookies, authorization or forwarding headers', async () => {
  seen.length = 0;
  await recording.inject({ method: 'POST', url: '/api/reports?draft=1', headers: { 'user-agent': claudeBot, accept: 'application/json', 'content-type': 'application/json', origin: 'https://evil.example', ...secrets }, payload: { private: 'body' } });
  assert.deepEqual(seen, [{ method: 'POST', url: '/api/reports?draft=1', headers: { 'user-agent': claudeBot, accept: 'application/json', 'signature-agent': undefined, 'sec-fetch-mode': undefined, referer: undefined, host: 'lichii.example' } }]);
});

test('normal browsers, non-GET requests and DNT or GPC signals send nothing and keep responses unchanged', async t => {
  const calls = stubDatabuddy(t);
  const browser = { 'user-agent': chrome, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'sec-fetch-mode': 'navigate', cookie: secrets.cookie };
  for (const { url } of paths) {
    assert.deepEqual(snapshot(await app.inject({ url, headers: browser })), snapshot(await untracked.inject({ url, headers: browser })), url);
  }
  await app.inject({ url: '/llms.txt', headers: { 'user-agent': gptBot, dnt: '1' } });
  await app.inject({ url: '/llms.txt', headers: { 'user-agent': gptBot, 'sec-gpc': '1' } });
  await app.inject({ method: 'POST', url: '/api/reports', headers: { 'user-agent': gptBot, origin: config.APP_ORIGIN, 'content-type': 'application/json' }, payload: {} });
  assert.equal(calls.length, 0);
});

test('a rejected, failing or hanging tracker never changes, delays or crashes a response', async t => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => { rejections.push(reason); };
  process.on('unhandledRejection', onRejection);
  t.after(() => { process.off('unhandledRejection', onRejection); });
  const headers = { 'user-agent': gptBot, accept: '*/*' };
  for (const { url } of paths) {
    const expected = snapshot(await untracked.inject({ url, headers }));
    for (const instance of [rejecting, hanging]) {
      const started = performance.now();
      assert.deepEqual(snapshot(await instance.inject({ url, headers })), expected, url);
      assert.ok(performance.now() - started < 1000, url);
    }
  }
  const failed = stubDatabuddy(t, () => Promise.reject(new TypeError('fetch failed')));
  assert.deepEqual(snapshot(await app.inject({ url: '/llms.txt', headers })), snapshot(await untracked.inject({ url: '/llms.txt', headers })));
  t.mock.restoreAll();
  const stalled = stubDatabuddy(t, () => new Promise<Response>(() => {}));
  const started = performance.now();
  assert.equal((await app.inject({ url: '/guide.md', headers })).statusCode, 404);
  assert.ok(performance.now() - started < 1000);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual([failed.length, stalled.length, rejections], [1, 1, []]);
});
