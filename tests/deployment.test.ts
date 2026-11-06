import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.ts';
import { connectDatabase } from '../server/db.ts';

test('private database CAs keep TLS verification enabled even when the URL requests no verification', async () => {
  const sql = connectDatabase('postgresql://user:synthetic-password@localhost/lichii_test?sslmode=no-verify', { ca: 'synthetic-ca', servername: 'postgres.railway.internal' });
  assert.deepEqual(sql.options.ssl, { ca: 'synthetic-ca', servername: 'postgres.railway.internal', rejectUnauthorized: true });
  await sql.end();
  const defaultName = connectDatabase('postgresql://user:synthetic-password@localhost/lichii_test', { ca: 'synthetic-ca', servername: undefined });
  assert.deepEqual(defaultName.options.ssl, { ca: 'synthetic-ca', rejectUnauthorized: true });
  await defaultName.end();
});

test('a database TLS server-name override requires an explicit trusted CA', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/lichii_test', APP_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'synthetic-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'synthetic-rate-limit-secret'.repeat(3), DATABASE_SSL_SERVERNAME: 'postgres.railway.internal' };
  assert.throws(() => readConfig(env), /requires DATABASE_SSL_CA/);
  assert.equal(readConfig({ ...env, DATABASE_SSL_CA: 'synthetic-ca', TRUST_PROXY: 'unkey' }).TRUST_PROXY, 'unkey');
});
