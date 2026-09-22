import { StoreError, type RecordRepository, type SyncUnitOfWork, type UnitOfWork } from '@/domain/records';

function storageError(error: unknown): unknown {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_CONSTRAINT_UNIQUE') || code.startsWith('SQLITE_CONSTRAINT_PRIMARYKEY')) return new StoreError('CONFLICT');
  if (code.startsWith('SQLITE_CONSTRAINT')) return new StoreError('INVALID_RECORD');
  if (code.startsWith('SQLITE_')) return new StoreError('STORAGE_UNAVAILABLE');
  return error;
}
/** Local-only scheduling. PostgreSQL uses database SERIALIZABLE isolation, never this queue. */
export function createAsyncLocalRepository(mode: 'mock' | 'sqlite', raw: SyncUnitOfWork, hooks: { begin(): void; commit(): void; rollback(): void; close(): void }): RecordRepository {
  let tail: Promise<void> = Promise.resolve(), closing: Promise<void> | null = null;
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new StoreError('STORAGE_UNAVAILABLE'));
    const result = tail.then(operation).catch(error => { throw storageError(error); });
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    mode,
    get: (kind, id) => enqueue(() => raw.get(kind, id)),
    list: (kind, contextId) => enqueue(() => raw.list(kind, contextId)),
    transaction: operation => enqueue(async () => {
      let active = true, poisoned: unknown = null, began = false;
      const pending = new Set<Promise<unknown>>();
      function perform<T>(fn: () => T): Promise<T> {
        if (!active) return Promise.reject(new StoreError('ASYNC_TRANSACTION'));
        const promise = Promise.resolve().then(() => {
          if (!active) throw new StoreError('ASYNC_TRANSACTION');
          return fn();
        }).catch(error => { poisoned = storageError(error); throw poisoned; });
        pending.add(promise);
        void promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      }
      const store: UnitOfWork = {
        get: (kind, id) => perform(() => raw.get(kind, id)),
        list: (kind, contextId) => perform(() => raw.list(kind, contextId)),
        create: (kind, input) => perform(() => raw.create(kind, input)),
        update: (kind, id, revision, data, migration) => perform(() => raw.update(kind, id, revision, data, migration)),
      };
      try {
        hooks.begin(); began = true;
        const result = await operation(store);
        active = false;
        if (pending.size) { await Promise.allSettled([...pending]); throw new StoreError('ASYNC_TRANSACTION'); }
        if (poisoned) throw poisoned;
        hooks.commit(); return result;
      } catch (error) {
        active = false; await Promise.allSettled([...pending]);
        if (began) hooks.rollback();
        throw storageError(error);
      } finally { active = false; }
    }),
    close() {
      if (!closing) closing = tail.then(() => hooks.close());
      return closing;
    },
  };
}
