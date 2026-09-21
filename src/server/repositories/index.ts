import "server-only";
import { readStorageConfig } from "@/server/config/env";
import { createMockRepository } from "./mock";
import { seed } from "@/server/db/seed";
import type { RecordRepository } from "@/domain/records";
const cache = globalThis as typeof globalThis & { gsHaleRepository?: { key: string; pending: Promise<RecordRepository> } };
export function getRepository(): Promise<RecordRepository> {
  const config = readStorageConfig();
  const key = `${config.dataSource}:${config.databaseFile}`;
  if (cache.gsHaleRepository?.key === key) return cache.gsHaleRepository.pending;
  const previous = cache.gsHaleRepository;
  const pending = (async () => {
    if (previous) { try { (await previous.pending).close(); } catch { /* An unavailable previous connection needs no close. */ } }
    if (config.dataSource === "mock") { const repository = createMockRepository(); await seed(repository); return repository; }
    const [{ openDatabase }, { createSqliteRepository }] = await Promise.all([import("@/server/db/database"), import("./sqlite")]);
    // Explicit migration/seed only: opening the app must not rewrite existing data.
    return createSqliteRepository(openDatabase(config.databaseFile));
  })();
  cache.gsHaleRepository = { key, pending };
  void pending.catch(() => { if (cache.gsHaleRepository?.pending === pending) delete cache.gsHaleRepository; });
  return pending;
}
