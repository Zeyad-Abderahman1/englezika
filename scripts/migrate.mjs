import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationsDirectory = path.resolve('database/migrations');
const files = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)'
  );
  await client.query('SELECT pg_advisory_lock($1)', [20260730]);
  try {
    for (const name of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rowCount) continue;
      const sql = await readFile(path.join(migrationsDirectory, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)',
          [name, Date.now()]
        );
        await client.query('COMMIT');
        process.stdout.write(`Applied ${name}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [20260730]);
  }
} finally {
  await client.end();
}
