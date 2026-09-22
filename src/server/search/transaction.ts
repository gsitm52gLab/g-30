import { jsonCopy, StoreError, type RecordRepository, type StoredRecord, type UnitOfWork } from '@/domain/records';

/** Lazy raw-row reads only, inside one SERIALIZABLE repository transaction.
 * No ACL decisions or cross-request values are cached. Every return is a copy.
 * The view rejects writes and is invalidated before its backing transaction ends.
 */
export async function searchTransaction<T>(repo: RecordRepository, fn: (s: UnitOfWork) => Promise<T>): Promise<T> {
  return repo.transaction(async backing => {
    let active = true;
    const gets = new Map<string, Promise<StoredRecord | null>>();
    const lists = new Map<string, Promise<StoredRecord[]>>();
    const ensureActive = () => { if (!active) throw new StoreError('ASYNC_TRANSACTION'); };
    const key = (kind: string, id: string) => JSON.stringify([kind, id]);
    const view: UnitOfWork = {
      async get(kind, id) {
        ensureActive(); const k = key(kind, id);
        if (!gets.has(k)) gets.set(k, backing.get(kind, id));
        const value = await gets.get(k)!; ensureActive();
        return jsonCopy(value) as StoredRecord<typeof kind> | null;
      },
      async list(kind, contextId) {
        ensureActive(); const k = JSON.stringify([kind, contextId ?? null]);
        if (!lists.has(k)) lists.set(k, backing.list(kind, contextId).then(rows => {
          // These rows were already explicitly requested. Do not eagerly read other kinds.
          for (const row of rows) if (!gets.has(key(kind, row.id))) gets.set(key(kind, row.id), Promise.resolve(row));
          return rows;
        }));
        const value = await lists.get(k)!; ensureActive();
        return jsonCopy(value) as StoredRecord<typeof kind>[];
      },
      async create() { ensureActive(); throw new StoreError('INVALID_RECORD'); },
      async update() { ensureActive(); throw new StoreError('INVALID_RECORD'); },
    };
    try { return await fn(view); }
    finally { active = false; gets.clear(); lists.clear(); }
  });
}
