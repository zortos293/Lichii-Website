import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { catalogEntrySchema } from '../shared/domain.ts';

export function connectDatabase(url: string, tls?: { ca: string; servername?: string }) {
  return postgres(url, { max: 8, idle_timeout: 20, connect_timeout: 10, onnotice: () => {}, ...(tls ? { ssl: { ca: tls.ca, ...(tls.servername ? { servername: tls.servername } : {}), rejectUnauthorized: true } } : {}) });
}
export type Database = ReturnType<typeof connectDatabase>;

export async function prepareDatabase(sql: Database, catalogPath = new URL('../data/catalog.json', import.meta.url)) {
  const entries = z.array(catalogEntrySchema).parse(JSON.parse(await readFile(catalogPath, 'utf8')));
  if (new Set(entries.map(e => e.sgdbId)).size !== entries.length || new Set(entries.map(e => e.slug)).size !== entries.length) throw new Error('Catalog IDs and slugs must be unique.');
  const migrations = await Promise.all(['001-initial.sql', '002-desktop-reporting.sql'].map(file => readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8')));
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(674393520)`;
    const [bootstrap] = await tx`SELECT to_regclass('schema_migrations') IS NOT NULL AS exists`;
    if (!bootstrap?.exists) await tx`CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const [index, migration] of migrations.entries()) {
      const version = index + 1;
      const applied = await tx`SELECT version FROM schema_migrations WHERE version = ${version}`;
      if (!applied.length) {
        await tx.unsafe(migration);
        await tx`INSERT INTO schema_migrations(version) VALUES (${version})`;
      }
    }
    for (const entry of entries) {
      await tx`INSERT INTO games(sgdb_id, slug, title, catalog) VALUES (${entry.sgdbId}, ${entry.slug}, ${entry.title}, ${tx.json(entry)})
        ON CONFLICT(sgdb_id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, catalog = EXCLUDED.catalog`;
    }
  });
  await cleanup(sql);
}

export async function cleanup(sql: Database) {
  await sql.begin(async tx => {
    await tx`DELETE FROM private_logs WHERE expires_at <= now()`;
    await tx`DELETE FROM sessions WHERE expires_at <= now()`;
    await tx`DELETE FROM oauth_attempts WHERE expires_at <= now()`;
    await tx`DELETE FROM rate_limits WHERE expires_at <= now()`;
  });
}
