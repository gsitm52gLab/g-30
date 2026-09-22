import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import path from 'node:path';
import type { PoolConfig } from 'pg';
import { PostgresConfigurationError } from './errors';

export const CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export interface PostgresConfig {
  schema: string;
  runtime: PoolConfig;
  migration: PoolConfig | null;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleTransactionTimeoutMs: number;
}
export function quoteSchema(schema: string): string {
  if (!/^gs_hale(?:_[a-z0-9_]+)?$/.test(schema) || schema.length > 63) throw new PostgresConfigurationError('SUPABASE_DB_SCHEMA');
  return `"${schema}"`;
}
function integer(value: string | undefined, fallback: number, max: number, field: string): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new PostgresConfigurationError(field);
  return Number(value);
}
export function loadSupabaseCa(filename = path.resolve('src/server/postgres/tls/supabase-prod-ca-2021.crt')): string {
  try {
    const pem = readFileSync(filename, 'utf8');
    const cert = new X509Certificate(pem);
    if (createHash('sha256').update(pem).digest('hex') !== CA_SHA256 || !cert.ca || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw new Error();
    return pem;
  } catch { throw new PostgresConfigurationError('SUPABASE_CA_CERTIFICATE'); }
}
function connection(value: string | undefined, field: string, project: string, ca: string, max: number): PoolConfig {
  try {
    if (!value || value.includes('[YOUR-PASSWORD]')) throw new Error();
    const url = new URL(value);
    const transaction = field === 'DATABASE_URL';
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || url.hash || url.pathname !== '/postgres') throw new Error();
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
    const direct = url.hostname === `db.${project}.supabase.co`;
    const port = Number(url.port || '5432');
    if (transaction ? !pooler || port !== 6543 : !(pooler || direct) || port !== 5432) throw new Error();
    const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    if (pooler ? !user.endsWith(`.${project}`) : user !== 'postgres') throw new Error();
    // Parse fields explicitly; pg connectionString sslmode must never override strict TLS.
    for (const [key, val] of url.searchParams) {
      if (key !== 'sslmode' || !['require', 'verify-full'].includes(val)) throw new Error();
    }
    return {
      host: url.hostname, port, user, password, database: 'postgres',
      ssl: { rejectUnauthorized: true, servername: url.hostname, ca: [...rootCertificates, ca], minVersion: 'TLSv1.2' },
      max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
      query_timeout: 30_000, allowExitOnIdle: true, application_name: 'gs-hale',
    };
  } catch { throw new PostgresConfigurationError(field); }
}
export function parsePostgresConfig(env: Record<string, string | undefined>, purpose: 'runtime' | 'migration' = 'runtime'): PostgresConfig {
  const ca = loadSupabaseCa();
  let project: string;
  try {
    // SQL pooler credentials identify their project independently of the Storage/Data API URL.
    // connection() below still enforces the allowed host, port, protocol, DB and strict TLS.
    const database = new URL(env.DATABASE_URL || '');
    const poolerUser = /^[A-Za-z_][A-Za-z0-9_]*\.([a-z0-9]+)$/.exec(decodeURIComponent(database.username));
    if (!poolerUser) throw new Error();
    project = poolerUser[1];
  } catch { throw new PostgresConfigurationError('DATABASE_URL'); }
  const schema = env.SUPABASE_DB_SCHEMA || 'gs_hale'; quoteSchema(schema);
  const max = integer(env.SUPABASE_POOL_MAX, 4, 20, 'SUPABASE_POOL_MAX');
  return {
    schema, runtime: connection(env.DATABASE_URL, 'DATABASE_URL', project, ca, max),
    migration: purpose === 'migration' ? connection(env.DIRECT_URL, 'DIRECT_URL', project, ca, 1) : null,
    statementTimeoutMs: integer(env.SUPABASE_STATEMENT_TIMEOUT_MS, 15_000, 120_000, 'SUPABASE_STATEMENT_TIMEOUT_MS'),
    lockTimeoutMs: integer(env.SUPABASE_LOCK_TIMEOUT_MS, 5_000, 30_000, 'SUPABASE_LOCK_TIMEOUT_MS'),
    idleTransactionTimeoutMs: integer(env.SUPABASE_IDLE_TRANSACTION_TIMEOUT_MS, 15_000, 120_000, 'SUPABASE_IDLE_TRANSACTION_TIMEOUT_MS'),
  };
}
