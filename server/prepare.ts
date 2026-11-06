import { readConfig } from './config.ts';
import { connectDatabase, prepareDatabase } from './db.ts';

const config = readConfig(process.env);
const sql = connectDatabase(config.DATABASE_URL, config.DATABASE_SSL_CA ? { ca: config.DATABASE_SSL_CA, servername: config.DATABASE_SSL_SERVERNAME } : undefined);
try { await prepareDatabase(sql); } finally { await sql.end(); }
