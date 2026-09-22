import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { begin, connect, createPostgresPool, query } from './client';
import { quoteSchema, type PostgresConfig } from './config';
import { PostgresMigrationError } from './errors';

export interface Migration { name: string; sql: string; sha256: string }
export function readMigrations(directory = path.resolve('src/server/postgres/migrations')): Migration[] {
  const names = readdirSync(directory).filter(file => /^\d{4}[-a-z]+\.sql$/.test(file)).sort();
  if (!names.length || names.some((name, index) => Number(name.slice(0, 4)) !== index + 1)) throw new PostgresMigrationError('INVALID_MIGRATIONS');
  return names.map(name => { const sql = readFileSync(path.join(directory, name), 'utf8'); return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') }; });
}
/** Explicit command only. All migrations and their checksums commit atomically; never reset/drop. */
export async function migratePostgres(config: PostgresConfig, migrations = readMigrations()) {
  const schema = quoteSchema(config.schema), pool = createPostgresPool(config, 'migration');
  let client: PoolClient | undefined;
  try {
    client = await connect(pool);
    await begin(client, config);
    // Transaction-level advisory lock is released at commit; compatible with transaction pooling.
    await query(client, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`gs-hale:migrations:${config.schema}`]);
    const inventory = await query<{ exists: boolean }>(client, 'SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists', [config.schema]);
    const existed = inventory.rows[0].exists;
    if (existed) {
      const owned = await query<{ marker: string | null; owned: boolean }>(client, 'SELECT obj_description(oid,\'pg_namespace\') AS marker, pg_get_userbyid(nspowner)=current_user AS owned FROM pg_namespace WHERE nspname=$1', [config.schema]);
      if (owned.rows[0].marker !== 'GS HALE application schema v1' || !owned.rows[0].owned) throw new PostgresMigrationError('SCHEMA_NOT_OWNED');
    } else {
      await query(client, `CREATE SCHEMA ${schema}`);
      await query(client, `COMMENT ON SCHEMA ${schema} IS 'GS HALE application schema v1'`);
    }
    await query(client, `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC, anon, authenticated`);
    await query(client, `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const history = await query<{ name: string; sha256: string }>(client, `SELECT name,sha256 FROM ${schema}.schema_migrations ORDER BY name`);
    if (history.rows.length > migrations.length || history.rows.some((row, index) => row.name !== migrations[index]?.name)) throw new PostgresMigrationError('MIGRATION_HISTORY');
    let applied = 0;
    for (const [index, migration] of migrations.entries()) {
      if (createHash('sha256').update(migration.sql).digest('hex') !== migration.sha256) throw new PostgresMigrationError('MIGRATION_CHECKSUM');
      const old = history.rows[index];
      if (old) { if (old.sha256 !== migration.sha256) throw new PostgresMigrationError('MIGRATION_CHECKSUM'); continue; }
      await query(client, migration.sql.replaceAll('__SCHEMA__', schema));
      await query(client, `INSERT INTO ${schema}.schema_migrations VALUES($1,$2,$3)`, [migration.name, migration.sha256, new Date().toISOString()]);
      applied++;
    }
    await query(client, `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated`);
    await query(client, `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated`);
    await query(client, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated`);
    await query(client, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated`);
    await query(client, `ALTER TABLE ${schema}.records ENABLE ROW LEVEL SECURITY`);
    await query(client, 'COMMIT');
    return { applied, total: migrations.length, schemaPreviouslyExisted: existed };
  } catch (error) { try { await client?.query('ROLLBACK'); } catch { /* already closed */ } throw error; }
  finally { client?.release(); await pool.end(); }
}
