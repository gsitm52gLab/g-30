import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { safePostgresError } from './errors';
import type { PostgresConfig } from './config';

export function createPostgresPool(config: PostgresConfig, purpose: 'runtime' | 'migration' = 'runtime'): Pool {
  const pool = new Pool(config[purpose]);
  // Idle network failures must not crash Node or leak raw driver diagnostics.
  pool.on('error', () => undefined);
  return pool;
}
export async function query<Row extends QueryResultRow = QueryResultRow>(client: PoolClient, text: string, values?: unknown[]) {
  try { return await client.query<Row>(text, values); } catch (error) { throw safePostgresError(error); }
}
export async function begin(client: PoolClient, config: PostgresConfig, readOnly = false) {
  await query(client, `BEGIN ISOLATION LEVEL SERIALIZABLE${readOnly ? ' READ ONLY' : ''}`);
  await query(client, "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)", [
    `${config.statementTimeoutMs}ms`, `${config.lockTimeoutMs}ms`, `${config.idleTransactionTimeoutMs}ms`,
  ]);
}
export async function connect(pool: Pool): Promise<PoolClient> {
  try { return await pool.connect(); } catch (error) { throw safePostgresError(error); }
}
