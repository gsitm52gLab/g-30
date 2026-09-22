import { StoreError } from '@/domain/records';

export class PostgresConfigurationError extends Error {
  constructor(readonly field: string) { super(`Invalid PostgreSQL configuration: ${field}`); this.name = 'PostgresConfigurationError'; }
}
export class PostgresMigrationError extends Error {
  constructor(readonly code: 'MIGRATION_CHECKSUM' | 'MIGRATION_HISTORY' | 'SCHEMA_NOT_OWNED' | 'INVALID_MIGRATIONS') {
    super(code); this.name = 'PostgresMigrationError';
  }
}
/** No raw driver message/detail/cause: these may contain passwords, SQL or row contents. */
export function safePostgresError(error: unknown): Error {
  if (error instanceof StoreError || error instanceof PostgresConfigurationError || error instanceof PostgresMigrationError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['23505', '40001', '40P01', '55P03'].includes(code)) return new StoreError('CONFLICT');
  if (['23503', '23514', '23502', '22P02', 'P0001'].includes(code)) return new StoreError('INVALID_RECORD');
  return new StoreError('STORAGE_UNAVAILABLE');
}
