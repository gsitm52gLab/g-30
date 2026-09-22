import type { RecordRepository, UnitOfWork } from '@/domain/records';

/** Real asynchronous reads/writes. Never pass this to a synchronous domain service. */
export type AsyncUnitOfWork = UnitOfWork;

export interface AsyncRecordRepository extends RecordRepository {
  readonly mode: 'supabase';
  /** One connection, SERIALIZABLE, no automatic replay. No external network work in callback. */
  transaction<T>(operation: (store: AsyncUnitOfWork) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}
