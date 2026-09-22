import type { RecordDataMap, RecordInput, RecordKind, StoredRecord } from '@/domain/records';

/** Real asynchronous reads/writes. Never pass this to a synchronous domain service. */
export interface AsyncUnitOfWork {
  get<K extends RecordKind>(kind: K, id: string): Promise<StoredRecord<K> | null>;
  list<K extends RecordKind>(kind: K, contextId?: string): Promise<StoredRecord<K>[]>;
  create<K extends RecordKind>(kind: K, input: RecordInput<K>): Promise<StoredRecord<K>>;
  update<K extends RecordKind>(kind: K, id: string, expectedRevision: number, data: RecordDataMap[K], migration?: { legacyProductContextId: string }): Promise<StoredRecord<K>>;
}

export interface AsyncRecordRepository {
  readonly mode: 'supabase';
  get<K extends RecordKind>(kind: K, id: string): Promise<StoredRecord<K> | null>;
  list<K extends RecordKind>(kind: K, contextId?: string): Promise<StoredRecord<K>[]>;
  /** One connection, SERIALIZABLE, no automatic replay. No external network work in callback. */
  transaction<T>(operation: (store: AsyncUnitOfWork) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
