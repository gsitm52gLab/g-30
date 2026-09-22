import { fail } from '@/server/auth/errors';
import { StorageCoreError } from '@/server/storage/contracts';
import { StorageError } from '@/server/storage/supabase';
import { STORAGE_LIMITS } from '@/domain/storage/types';
import { digest } from '@/domain/storage/validate';
import { json } from '@/server/http/identity';
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
/** Parsed state stays private JSONB; only its current-authorized DTO crosses this bounded API. */
export function privateJsonResponse(request: Request, value: unknown, id: string, downloadUrl: string) {
  const bytes = Buffer.from(JSON.stringify(value)), sha256 = digest(bytes);
  if (bytes.length > STORAGE_LIMITS.importBytes) fail('RESOURCE_LIMIT', 422, '미리보기 표시 크기를 확인해 주세요.');
  const metadata = { id, name: `${id}.json`, mime: 'application/json', bytes: bytes.length, sha256, etag: `"${sha256}"`, chunkBytes: STORAGE_LIMITS.chunkBytes, downloadUrl };
  if (new URL(request.url).searchParams.get('transfer') === '1') return json(metadata);
  if (request.headers.has('range')) { const r = requestRange(request, bytes.length, metadata.etag); return rangeResponse(bytes.subarray(r.start, r.end + 1), metadata, r.start, r.end); }
  if (bytes.length > STORAGE_LIMITS.chunkBytes) fail('RANGE_REQUIRED', 422, '범위 다운로드로 전체 미리보기를 확인해 주세요.');
  return json(value);
}
