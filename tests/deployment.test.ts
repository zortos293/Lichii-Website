import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseTls, readConfig } from '../server/config.ts';
import { connectDatabase } from '../server/db.ts';

const base = { DATABASE_URL: 'postgresql://user:synthetic-password@localhost/lichii_test', APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'c'.repeat(32), RATE_LIMIT_SECRET: 'r'.repeat(32) };

test('a pinned database CA keeps TLS verification on even when the URL asks for less', async () => {
  const config = readConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=require`, DATABASE_SSL_CA: 'synthetic-ca', DATABASE_SSL_SERVERNAME: 'localhost' });
  const sql = connectDatabase(config.DATABASE_URL, databaseTls(config));
  assert.deepEqual(sql.options.ssl, { ca: 'synthetic-ca', servername: 'localhost', rejectUnauthorized: true });
  await sql.end();
  const hostChecked = connectDatabase(base.DATABASE_URL, databaseTls(readConfig({ ...base, DATABASE_SSL_CA: 'synthetic-ca' })));
  assert.deepEqual(hostChecked.options.ssl, { ca: 'synthetic-ca', rejectUnauthorized: true });
  await hostChecked.end();
  assert.equal(databaseTls(readConfig(base)), undefined);
});

test('a TLS server name override without a CA is rejected', () => {
  assert.throws(() => readConfig({ ...base, DATABASE_SSL_SERVERNAME: 'localhost' }), /requires DATABASE_SSL_CA/);
});

test('the database tunnel sidecar gets the Access service token and the app does not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lichii-entrypoint-'));
  const record = join(dir, 'cloudflared.json');
  const appRecord = join(dir, 'app.json');
  await writeFile(join(dir, 'listener.mjs'), `import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), id: process.env.TUNNEL_SERVICE_TOKEN_ID, secret: process.env.TUNNEL_SERVICE_TOKEN_SECRET }));
createServer().listen(5432, '127.0.0.1').on('error', () => {});
`);
  await writeFile(join(dir, 'cloudflared'), `#!/bin/sh\nexec node ${join(dir, 'listener.mjs')} "$@"\n`, { mode: 0o755 });
  const entrypoint = spawn('sh', ['server/entrypoint.sh', 'node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(appRecord)}, JSON.stringify({ id: process.env.TUNNEL_SERVICE_TOKEN_ID ?? null, secret: process.env.TUNNEL_SERVICE_TOKEN_SECRET ?? null }))`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATABASE_TUNNEL_HOSTNAME: 'db.example.test', TUNNEL_SERVICE_TOKEN_ID: 'synthetic-id', TUNNEL_SERVICE_TOKEN_SECRET: 'synthetic-secret' },
  });
  const [code] = await once(entrypoint, 'exit');
  process.kill(-entrypoint.pid!, 'SIGKILL');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(appRecord, 'utf8')), { id: null, secret: null });
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), { args: ['access', 'tcp', '--hostname', 'db.example.test', '--url', '127.0.0.1:5432', '--loglevel', 'warn'], id: 'synthetic-id', secret: 'synthetic-secret' });
  await rm(dir, { recursive: true, force: true });
});

test('the database tunnel refuses to start without a service token', () => {
  const result = spawnSync('sh', ['server/entrypoint.sh', 'true'], { encoding: 'utf8', env: { ...process.env, DATABASE_TUNNEL_HOSTNAME: 'db.example.test', TUNNEL_SERVICE_TOKEN_ID: '', TUNNEL_SERVICE_TOKEN_SECRET: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires TUNNEL_SERVICE_TOKEN_ID/);
});

test('without a tunnel hostname the entrypoint only runs the app', () => {
  const result = spawnSync('sh', ['server/entrypoint.sh', 'node', '-e', 'process.stdout.write("app")'], { encoding: 'utf8', env: { ...process.env, DATABASE_TUNNEL_HOSTNAME: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'app');
});
