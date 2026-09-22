import { DownloadMetadata, FileTransferError } from './contracts';
const CHUNK = 4 * 1024 * 1024, MAXIMUM = 64 * 1024 * 1024;
function invalid(): never { throw new FileTransferError('INTEGRITY'); }
function localURL(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/api/') || value.includes('\\') || /[\x00-\x1f]/.test(value)) invalid();
  const parsed = new URL(value, 'https://gs-hale.invalid');
  if (parsed.origin !== 'https://gs-hale.invalid' || !parsed.pathname.startsWith('/api/') || parsed.hash) invalid();
  return parsed.pathname + parsed.search;
}
export function downloadMetadata(value: unknown, maximumBytes = MAXIMUM): DownloadMetadata {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const d = value as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name || /[\x00-\x1f\x7f/\\]/.test(d.name) || typeof d.mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(d.mime)
    || typeof d.bytes !== 'number' || !Number.isSafeInteger(d.bytes) || d.bytes < 1 || d.bytes > maximumBytes || typeof d.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.sha256)
    || d.etag !== `"${d.sha256}"` || d.chunkBytes !== CHUNK) invalid();
  return { id: d.id, name: d.name, mime: d.mime, bytes: d.bytes, sha256: d.sha256, etag: d.etag, chunkBytes: CHUNK, downloadUrl: localURL(d.downloadUrl) };
}
async function body(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) { await response.body?.cancel(); invalid(); }
  const reader = response.body?.getReader(); if (!reader) invalid();
  const parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maximum) invalid(); parts.push(part.value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
async function success(response: Response, expected: number) {
  if (response.status !== expected) { await response.body?.cancel(); throw new FileTransferError([401,403,404,409,412].includes(response.status) ? 'ACCESS_CHANGED' : 'TRANSFER_FAILED', response.status); }
}
export async function boundedDownload(metadataURL: string, options: { signal?: AbortSignal; maximumBytes?: number; fetcher?: typeof fetch } = {}): Promise<{ blob: Blob; metadata: DownloadMetadata }> {
  const fetcher = options.fetcher ?? fetch;
  const get = (url: string, headers?: Record<string, string>) => fetcher(localURL(url), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), headers });
  try {
    options.signal?.throwIfAborted();
    const response = await get(metadataURL); await success(response, 200);
    let parsed: unknown; try { parsed = JSON.parse(new TextDecoder().decode(await body(response, 65536))); } catch { invalid(); }
    const metadata = downloadMetadata(parsed, options.maximumBytes), chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let start = 0; start < metadata.bytes; start += CHUNK) {
      options.signal?.throwIfAborted(); const end = Math.min(start + CHUNK - 1, metadata.bytes - 1), response = await get(metadata.downloadUrl, { Range: `bytes=${start}-${end}`, 'If-Match': metadata.etag });
      await success(response, 206);
      if (response.headers.get('etag') !== metadata.etag || response.headers.get('content-range') !== `bytes ${start}-${end}/${metadata.bytes}`) { await response.body?.cancel(); invalid(); }
      const bytes = await body(response, end - start + 1); if (bytes.length !== end - start + 1) invalid(); chunks.push(bytes);
    }
    const blob = new Blob(chunks, { type: metadata.mime });
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (blob.size !== metadata.bytes || digest !== metadata.sha256) invalid();
    options.signal?.throwIfAborted(); return { blob, metadata };
  } catch (error) { if (options.signal?.aborted) throw new FileTransferError('ABORTED'); if (error instanceof FileTransferError) throw error; throw new FileTransferError('TRANSFER_FAILED'); }
}
