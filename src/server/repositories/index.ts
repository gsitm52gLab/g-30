import "server-only";
import { readStorageConfig } from "@/server/config/env";
import { createMockRepository } from "./mock";
import { seed } from "@/server/db/seed";
import type { RecordRepository } from "@/domain/records";
import { createHash } from 'node:crypto';
const cache = globalThis as typeof globalThis & { gsHaleRepository?: { key: string; pending: Promise<RecordRepository> } };
export function getRepository(): Promise<RecordRepository> {
  const config = readStorageConfig();
  // Only a one-way identity is retained in the cache key; never put DSNs in diagnostics.
  const remoteKey = config.dataSource === 'supabase' ? createHash('sha256').update([process.env.DATABASE_URL, process.env.SUPABASE_URL, process.env.SUPABASE_DB_SCHEMA, process.env.SUPABASE_POOL_MAX, process.env.SUPABASE_STATEMENT_TIMEOUT_MS, process.env.SUPABASE_LOCK_TIMEOUT_MS, process.env.SUPABASE_IDLE_TRANSACTION_TIMEOUT_MS].join('\0')).digest('hex') : '';
  const key = `${config.dataSource}:${config.databaseFile}:${remoteKey}`;
  if (cache.gsHaleRepository?.key === key) return cache.gsHaleRepository.pending;
  const previous = cache.gsHaleRepository;
  const pending = (async () => {
    if (previous) { try { await (await previous.pending).close(); } catch { /* An unavailable previous connection needs no close. */ } }
    if (config.dataSource === "mock") { const repository = createMockRepository(); await seed(repository); return repository; }
    if (config.dataSource === 'supabase') {
      const { parsePostgresConfig, createPostgresRepository } = await import('@/server/postgres');
      return createPostgresRepository(parsePostgresConfig(process.env));
    }
    const [{ openDatabase }, { createSqliteRepository }] = await Promise.all([import("@/server/db/database"), import("./sqlite")]);
    // Explicit migration/seed only: opening the app must not rewrite existing data.
    return createSqliteRepository(openDatabase(config.databaseFile));
  })();
  cache.gsHaleRepository = { key, pending };
  void pending.catch(() => { if (cache.gsHaleRepository?.pending === pending) delete cache.gsHaleRepository; });
  return pending;
}
