import type { Pool, PoolClient } from 'pg';
import { checkInput, jsonCopy, StoreError, systemClock, updatedContext, type Clock, type RecordKind, type StoredRecord } from '@/domain/records';
import { begin, connect, createPostgresPool, query } from './client';
import { quoteSchema, type PostgresConfig } from './config';
import type { AsyncRecordRepository, AsyncUnitOfWork } from './types';
import { checkRelations } from './relations';
import { decodeRevision } from './revision';

interface Row { kind: RecordKind; id: string; context_id: string | null; data: StoredRecord['data']; revision: number | string; created_at: string; updated_at: string }
function decode<K extends RecordKind>(row: Row): StoredRecord<K> {
  return { kind: row.kind as K, id: row.id, contextId: row.context_id, data: row.data as StoredRecord<K>['data'], revision: decodeRevision(row.revision), createdAt: row.created_at, updatedAt: row.updated_at };
}
function reader(client: PoolClient, table: string): Pick<AsyncUnitOfWork, 'get' | 'list'> {
  return {
    async get<K extends RecordKind>(kind: K, id: string) {
      const result = await query<Row>(client, `SELECT * FROM ${table} WHERE kind=$1 AND id=$2`, [kind, id]);
      return result.rows[0] ? decode<K>(result.rows[0]) : null;
    },
    async list<K extends RecordKind>(kind: K, contextId?: string) {
      const result = contextId === undefined
        ? await query<Row>(client, `SELECT * FROM ${table} WHERE kind=$1 ORDER BY id COLLATE "C"`, [kind])
        : await query<Row>(client, `SELECT * FROM ${table} WHERE kind=$1 AND context_id=$2 ORDER BY id COLLATE "C"`, [kind, contextId]);
      return result.rows.map(row => decode<K>(row));
    },
  };
}
export function createPostgresRepository(config: PostgresConfig, clock: Clock = systemClock, suppliedPool?: Pool): AsyncRecordRepository {
  const pool = suppliedPool || createPostgresPool(config);
  const table = `${quoteSchema(config.schema)}.records`;
  let closed = false;
  async function run<T>(operation: (store: AsyncUnitOfWork) => Promise<T>, readOnly = false): Promise<T> {
    if (closed) throw new StoreError('STORAGE_UNAVAILABLE');
    const client = await connect(pool);
    let active = true, poisoned: unknown = null;
    const pending = new Set<Promise<unknown>>();
    const reads = reader(client, table);
    const uow: AsyncUnitOfWork = {
      ...reads,
      async create(kind, input) {
        checkInput(input);
        const copy = jsonCopy(input.data);
        await checkRelations(uow, kind, { ...input, data: copy });
        const now = clock();
        const result = await query<Row>(client, `INSERT INTO ${table}(kind,id,context_id,data,revision,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,1,$5,$5) RETURNING *`, [kind, input.id, input.contextId, JSON.stringify(copy), now]);
        return decode(result.rows[0]);
      },
      async update(kind, id, expectedRevision, data, migration) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new StoreError('INVALID_RECORD');
        const old = await reads.get(kind, id);
        if (!old) throw new StoreError('NOT_FOUND');
        if (old.revision !== expectedRevision) throw new StoreError('CONFLICT');
        const copy = jsonCopy(data), contextId = updatedContext(old, copy, migration);
        checkInput({ id, contextId, data: copy });
        await checkRelations(uow, kind, { id, contextId, data: copy });
        const result = await query<Row>(client, `UPDATE ${table} SET data=$1::jsonb,context_id=$2,revision=revision+1,updated_at=$3 WHERE kind=$4 AND id=$5 AND revision=$6 RETURNING *`, [JSON.stringify(copy), contextId, clock(), kind, id, expectedRevision]);
        if (!result.rows[0]) throw new StoreError('CONFLICT');
        return decode(result.rows[0]);
      },
    };
    const guarded = new Proxy(uow, {
      get(target, property: keyof AsyncUnitOfWork) {
        return (...args: unknown[]) => {
          if (!active) return Promise.reject(new StoreError('ASYNC_TRANSACTION'));
          const promise = Promise.resolve().then(() => Reflect.apply(target[property], target, args))
            .catch(error => { poisoned = error; throw error; });
          pending.add(promise);
          void promise.then(() => pending.delete(promise), () => pending.delete(promise));
          return promise;
        };
      },
    });
    let releaseError = false;
    try {
      await begin(client, config, readOnly);
      const result = await operation(guarded);
      active = false;
      if (pending.size) { await Promise.allSettled([...pending]); throw new StoreError('ASYNC_TRANSACTION'); }
      if (poisoned) throw poisoned;
      await query(client, 'COMMIT');
      return result;
    } catch (error) {
      active = false;
      await Promise.allSettled([...pending]);
      try { await client.query('ROLLBACK'); } catch { releaseError = true; }
      throw error;
    } finally { active = false; client.release(releaseError); }
  }
  return {
    mode: 'supabase', get: (kind, id) => run(s => s.get(kind, id), true), list: (kind, contextId) => run(s => s.list(kind, contextId), true),
    transaction: operation => run(operation),
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
