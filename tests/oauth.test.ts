import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { prepareDatabase } from '../server/db.ts';

test('GitHub issuer callbacks complete sign-in while unexpected issuers are rejected', async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
  const sql = postgres(databaseUrl, { connection: { search_path: 'oauth_regression' }, onnotice: () => {} });
  const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: 'https://lichii.example', COOKIE_SECRET: 'test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'test-rate-limit-secret'.repeat(3), NODE_ENV: 'test', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ALLOWED_ID: '65777760' });
  const app = await createApp(config, sql, false);
  t.after(async () => {
    await app.close();
    await sql`DROP SCHEMA IF EXISTS oauth_regression CASCADE`;
    await sql.end();
  });
  await sql`CREATE SCHEMA oauth_regression`;
  await prepareDatabase(sql);
  const calls: string[] = [];
  const warnings: unknown[][] = [];
  t.mock.method(app.log, 'warn', (...args: unknown[]) => { warnings.push(args); });
  let tokenError: string | undefined;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('redirect_uri'), `${config.APP_ORIGIN}/api/auth/callback`);
      assert.equal(body.get('client_secret'), 'test-secret');
      assert.ok(body.get('code_verifier'));
      if (tokenError) return Response.json({ error: tokenError, error_description: 'PRIVATE_ERROR_SENTINEL', access_token: 'PRIVATE_TOKEN_SENTINEL' });
      return Response.json({ access_token: 'synthetic-access-token', token_type: 'bearer', scope: 'read:user' });
    }
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-access-token');
    return Response.json({ id: 65777760, login: 'zortos293' });
  });
  const start = await app.inject({ url: '/api/auth/login' });
  const authUrl = new URL(String(start.headers.location));
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const query = new URLSearchParams({ code: 'synthetic-code', state: authUrl.searchParams.get('state') ?? '', iss: 'https://github.com/login/oauth' });
  const callback = await app.inject({ url: `/api/auth/callback?${query}`, headers: { cookie } });
  assert.deepEqual(calls, ['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
  assert.equal(callback.headers.location, '/maintainer');
  const cookies = callback.headers['set-cookie'];
  const session = (Array.isArray(cookies) ? cookies : [String(cookies)]).find(value => value.startsWith('__Host-lichii-session='));
  assert.ok(session);
  const status = await app.inject({ url: '/api/auth/status', headers: { cookie: session.split(';')[0] } });
  assert.equal(status.json().authenticated, true);
  assert.equal((await sql`SELECT 1 FROM audit_events WHERE action = 'sign-in'`).length, 1);
  const repeated = await app.inject({ url: `/api/auth/callback?${query}`, headers: { cookie } });
  assert.equal(repeated.headers.location, '/maintainer?error=sign-in-failed');
  assert.equal(calls.length, 2);
  const next = await app.inject({ url: '/api/auth/login' });
  query.set('state', new URL(String(next.headers.location)).searchParams.get('state') ?? '');
  query.set('iss', 'https://attacker.example');
  const rejected = await app.inject({ url: `/api/auth/callback?${query}`, headers: { cookie: String(next.headers['set-cookie']).split(';')[0] } });
  assert.equal(rejected.headers.location, '/maintainer?error=sign-in-failed');
  assert.equal(calls.length, 2);
  for (const reason of ['incorrect_client_credentials', 'bad_verification_code', 'redirect_uri_mismatch', 'PRIVATE_UNKNOWN_ERROR_SENTINEL']) {
    tokenError = reason;
    const attempt = await app.inject({ url: '/api/auth/login' });
    const state = new URL(String(attempt.headers.location)).searchParams.get('state') ?? '';
    const query = new URLSearchParams({ code: 'synthetic-code', state, iss: 'https://github.com/login/oauth' });
    const failed = await app.inject({ url: `/api/auth/callback?${query}`, headers: { cookie: String(attempt.headers['set-cookie']).split(';')[0] } });
    assert.equal(failed.headers.location, '/maintainer?error=sign-in-failed');
    assert.deepEqual(warnings.at(-1), [{ stage: 'token-response', reason: reason.startsWith('PRIVATE_') ? 'unclassified' : reason }, 'GitHub sign-in failed']);
  }
  assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_(ERROR|TOKEN|UNKNOWN_ERROR)_SENTINEL/);
});
