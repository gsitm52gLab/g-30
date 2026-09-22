import { fail } from '@/server/auth/errors';
import { StorageCoreError } from '@/server/storage/contracts';
import { StorageError } from '@/server/storage/supabase';
import { STORAGE_LIMITS } from '@/domain/storage/types';
export async function storageAction<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (e) {
    if (e instanceof StorageCoreError) fail(e.code, e.status, '자료 상태를 확인하고 다시 시도해 주세요.');
    if (e instanceof StorageError) fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'CONFLICT' ? 'CONFLICT' : 'STORAGE_UNAVAILABLE', e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 503, '원본 저장소를 사용할 수 없습니다. 입력을 유지해 주세요.');
    throw e;
  }
}
export function requestRange(request: Request, bytes: number, etag: string): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('range') ?? '');
  const expected = request.headers.get('if-match');
  if (expected !== etag) fail('CONFLICT', 412, '파일 버전을 다시 확인해 주세요.');
  if (!match) fail('RANGE_REQUIRED', 416, '범위를 지정하여 파일을 내려받아 주세요.');
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= bytes || end - start + 1 > STORAGE_LIMITS.chunkBytes) fail('VALIDATION', 416, '파일 범위를 확인해 주세요.');
  return { start, end };
}
export function rangeResponse(bytes: Buffer, metadata: { name: string; mime: string; bytes: number; etag: string }, start: number, end: number) {
  return new Response(new Uint8Array(bytes), { status: 206, headers: { 'Content-Type': metadata.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'Content-Length': String(bytes.length), 'Content-Range': `bytes ${start}-${end}/${metadata.bytes}`, 'Accept-Ranges': 'bytes', ETag: metadata.etag, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer' } });
}
