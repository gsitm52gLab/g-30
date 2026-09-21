import { createHash } from 'node:crypto';

export class ReviewContractError extends Error {
  constructor(readonly code: 'CORPUS_INVALID' | 'RESULT_INVALID' | 'LOCATION_INVALID' | 'REVIEW_INVALID') {
    super(code); this.name = 'ReviewContractError';
  }
}
export function invalid(code: ReviewContractError['code'] = 'CORPUS_INVALID'): never { throw new ReviewContractError(code); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !value.isWellFormed()) invalid();
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 180); if (!/^[a-zA-Z0-9_-]+$/.test(result)) invalid(); return result;
}
export function hash(value: unknown): string {
  const result = text(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) invalid(); return result;
}
export function integer(value: unknown, min = 0, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(); return value;
}
export function array(value: unknown, max = 100): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(); return value;
}
export function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) invalid(); return value as T;
}
export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
/** Only call after explicit projection; never hash arbitrary provider objects recursively. */
export function contentHash(value: object): string { return sha256(JSON.stringify(value)); }
export function date(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid();
  return result;
}
export function unique(values: string[]): void { if (new Set(values).size !== values.length) invalid(); }
