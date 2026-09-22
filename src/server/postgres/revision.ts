import { StoreError } from '@/domain/records';

/** pg decodes BIGINT as decimal text. Never accept silent IEEE-754 rounding. */
export function decodeRevision(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) throw new StoreError('INVALID_RECORD');
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new StoreError('INVALID_RECORD');
  return revision;
}
