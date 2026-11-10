import { test } from 'node:test';
import assert from 'node:assert/strict';
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
