import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_FILE_BYTES, validateFile } from '@/domain/files/validate';

export const STORAGE_CHUNK_BYTES = 4 * 1024 * 1024;
export const STORAGE_TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const JSON_LIMIT = 64 * 1024;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export type StorageErrorCode = 'CONFIG' | 'INVALID_INPUT' | 'BUCKET_POLICY' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | 'BUSY' | 'PROTOCOL' | 'INTEGRITY' | 'TOO_LARGE' | 'NOT_EXPIRED';
/** Never includes a remote body, signed URL, secret, or underlying fetch error. */
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, readonly status?: number, readonly outcome: 'unchanged' | 'unknown' = 'unchanged') {
    super(`Storage operation failed (${code}).`);
    this.name = 'StorageError';
  }
}
export interface SupabaseStorageConfig {
  projectUrl: string;
  secretKey: string;
  bucket: string;
  /** Isolates application/test objects. Must be server configuration, never browser input. */
  namespace: string;
  timeoutMs?: number;
  readRetries?: number;
  maxConcurrentRequests?: number;
}
export interface StorageObject {
  key: string;
  id: string;
  version: string;
  bytes: number;
  etag: string;
  contentType: string;
}
export interface VerifiedObject extends StorageObject {
  sha256: string;
  originalName: string;
  mime: string;
  preview: boolean;
}
export interface UploadGrant {
  key: string;
  bucket: string;
  signedUrl: string;
  token: string;
  method: 'PUT';
  resumableEndpoint: string;
  tusChunkBytes: number;
  /** Application deadline checked by the caller's shared DB, NOT a Storage token restriction. */
  appExpiresAt: number;
  storageExpiresAt: number;
  /** Conservative deadline for removing an unused grant, including a late TUS upload. */
  safeCleanupAfter: number;
  expectedBytes: number;
  bucketMaxBytes: number;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageError('PROTOCOL');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function normalizeEtag(value: unknown): string {
  if (typeof value !== 'string' || !/^"?[a-fA-F0-9]{32}(?:-\d+)?"?$/.test(value)) throw new StorageError('PROTOCOL');
  return `"${value.replaceAll('"', '').toLowerCase()}"`;
}
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value); }
function sameObject(a: StorageObject, b: StorageObject): boolean {
  return a.key === b.key && a.id === b.id && a.version === b.version && a.bytes === b.bytes && a.etag === b.etag;
}
async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); throw new StorageError('TOO_LARGE'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > limit) throw new StorageError('TOO_LARGE');
      parts.push(result.value);
    }
    return Buffer.concat(parts, bytes);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
/** Supabase's authenticated object reads use this exact envelope with HTTP400 for absence.
 * Only bounded structured codes are interpreted; remote messages never become diagnostics. */
async function missingObjectEnvelope(response: Response): Promise<boolean> {
  try {
    const data: unknown = JSON.parse((await boundedBody(response, JSON_LIMIT)).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const value = data as Record<string, unknown>;
    return value.statusCode === '404' && value.error === 'not_found' && value.code === 'NoSuchKey';
  } catch { return false; }
}
/** Transport only: callers must perform current app authorization before AND after each operation. */
export class SupabasePrivateStorage {
  #url: string;
  #secret: string;
  #bucket: string;
  #namespace: string;
  #timeout: number;
  #retries: number;
  #concurrency: number;
  #active = 0;
  #fetch: typeof fetch;
  constructor(config: SupabaseStorageConfig, fetcher: typeof fetch = fetch) {
    let url: URL;
    try { url = new URL(config.projectUrl); } catch { throw new StorageError('CONFIG'); }
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !['/', '/rest/v1', '/rest/v1/', '/storage/v1', '/storage/v1/'].includes(url.pathname)) throw new StorageError('CONFIG');
    let isServerKey = /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(config.secretKey);
    if (!isServerKey && /^eyJ[A-Za-z0-9_.-]+$/.test(config.secretKey)) {
      try { isServerKey = JSON.parse(Buffer.from(config.secretKey.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* fail closed below */ }
    }
    if (!isServerKey || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(config.bucket) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.namespace)) throw new StorageError('CONFIG');
    this.#url = url.origin;
    this.#secret = config.secretKey;
    this.#bucket = config.bucket;
    this.#namespace = config.namespace;
    this.#timeout = config.timeoutMs ?? 30_000;
    this.#retries = config.readRetries ?? 1;
    this.#concurrency = config.maxConcurrentRequests ?? 4;
    if (!integer(this.#timeout, 50, 120_000) || !integer(this.#retries, 0, 2) || !integer(this.#concurrency, 1, 16)) throw new StorageError('CONFIG');
    this.#fetch = fetcher;
  }
  allocateStagingKey(): string { return `${this.#namespace}/staging/${randomUUID()}`; }
  allocateFinalKey(): string { return `${this.#namespace}/final/${randomUUID()}`; }
  #key(key: string, kind: 'staging' | 'final' | 'either' = 'either') {
    const lane = kind === 'either' ? '(?:staging|final)' : kind;
    if (!new RegExp(`^${this.#namespace}/${lane}/${UUID}$`).test(key)) throw new StorageError('INVALID_INPUT');
    return key.split('/').map(encodeURIComponent).join('/');
  }
  #objectPath(key: string) { return `${encodeURIComponent(this.#bucket)}/${this.#key(key)}`; }
  async #request<T>(path: string, method: string, consume: (r: Response) => Promise<T>, body?: string | Uint8Array, headers?: Record<string, string>): Promise<T> {
    if (this.#active >= this.#concurrency) throw new StorageError('BUSY');
    this.#active++;
    const read = method === 'GET' || method === 'HEAD';
    try {
      for (let attempt = 0;; attempt++) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#timeout);
        try {
          const response = await this.#fetch(`${this.#url}/storage/v1${path}`, {
            method, redirect: 'error', cache: 'no-store', signal: controller.signal,
            headers: { apikey: this.#secret, authorization: `Bearer ${this.#secret}`, ...headers },
            ...(body === undefined ? {} : { body: body as BodyInit }),
          });
          if (!response.ok) {
            const status = response.status;
            const objectRead = method === 'GET' && (path.startsWith('/object/info/authenticated/') || path.startsWith('/object/authenticated/'));
            const missingObject = status === 400 && objectRead && await missingObjectEnvelope(response);
            if (!response.bodyUsed) await response.body?.cancel();
            const code = status === 404 || missingObject ? 'NOT_FOUND' : status === 409 || status === 412 ? 'CONFLICT' : status === 413 ? 'TOO_LARGE' : 'UNAVAILABLE';
            if (read && attempt < this.#retries && (status === 429 || status >= 500)) continue;
            throw new StorageError(code, status, read || status < 500 ? 'unchanged' : 'unknown');
          }
          try { return await consume(response); }
          catch (error) {
            if (!read && error instanceof StorageError) throw new StorageError(error.code, error.status, 'unknown');
            throw error;
          }
        } catch (error) {
          if (error instanceof StorageError) throw error;
          if (read && attempt < this.#retries) continue;
          throw new StorageError(controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE', undefined, read ? 'unchanged' : 'unknown');
        } finally { clearTimeout(timer); }
      }
    } finally { this.#active--; }
  }
  #json(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<unknown> {
    return this.#request(path, method, async r => {
      const bytes = await boundedBody(r, JSON_LIMIT);
      try { return JSON.parse(bytes.toString('utf8')); } catch { throw new StorageError('PROTOCOL', r.status, method === 'GET' ? 'unchanged' : 'unknown'); }
    }, body === undefined ? undefined : JSON.stringify(body), { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
  }
  /** Explicit provisioning only. Never changes existing bucket visibility, limits, or policies. */
  async ensurePrivateBucket(): Promise<{ created: boolean }> {
    let bucket: Record<string, unknown>, created = false;
    try { bucket = object(await this.#json(`/bucket/${this.#bucket}`)); }
    catch (error) {
      // Supabase currently reports a missing bucket as HTTP 400; distinguish using inventory.
      if (!(error instanceof StorageError) || ![400, 404].includes(error.status ?? 0)) throw error;
      const inventory = await this.#json('/bucket');
      if (!Array.isArray(inventory)) throw new StorageError('PROTOCOL');
      if (inventory.some(b => object(b).id === this.#bucket)) throw error;
      await this.#json('/bucket', 'POST', { id: this.#bucket, name: this.#bucket, public: false, file_size_limit: MAX_FILE_BYTES });
      created = true;
      bucket = object(await this.#json(`/bucket/${this.#bucket}`));
    }
    if (bucket.id !== this.#bucket || bucket.public !== false || Number(bucket.file_size_limit) !== MAX_FILE_BYTES || bucket.allowed_mime_types != null && (!Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types.length !== 0)) throw new StorageError('BUCKET_POLICY');
    return { created };
  }
  /** Only return this DTO after app ACL + shared grant row commit. It contains a scoped upload capability. */
  async issueUploadGrant(input: { key: string; expectedBytes: number; appExpiresAt: number; now?: number }): Promise<UploadGrant> {
    this.#key(input.key, 'staging');
    const now = input.now ?? Date.now();
    if (!integer(input.expectedBytes, 1, MAX_FILE_BYTES) || !integer(input.appExpiresAt, now + 1, now + 15 * 60_000)) throw new StorageError('INVALID_INPUT');
    const response = object(await this.#json(`/object/upload/sign/${this.#objectPath(input.key)}`, 'POST', {}, { 'x-upsert': 'false' }));
    if (typeof response.url !== 'string' || response.url.length > 16_384) throw new StorageError('PROTOCOL');
    const url = new URL(`${this.#url}/storage/v1${response.url}`);
    if (url.origin !== this.#url || url.pathname !== `/storage/v1/object/upload/sign/${this.#objectPath(input.key)}` || url.hash || [...url.searchParams.keys()].some(k => k !== 'token')) throw new StorageError('PROTOCOL');
    const token = url.searchParams.get('token');
    if (!token || token.length > 8192 || token.split('.').length !== 3) throw new StorageError('PROTOCOL');
    let claims: Record<string, unknown>;
    try { claims = object(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())); } catch { throw new StorageError('PROTOCOL'); }
    // These claims are sanity checks on the authenticated server response, not local JWT authentication.
    if (claims.url !== `${this.#bucket}/${input.key}` || claims.upsert !== false || !integer(claims.exp, Math.floor(now / 1000) + 1, Math.floor(now / 1000) + 24 * 3600)) throw new StorageError('PROTOCOL');
    const storageExpiresAt = claims.exp * 1000;
    if (input.appExpiresAt > storageExpiresAt) throw new StorageError('PROTOCOL');
    return { key: input.key, bucket: this.#bucket, signedUrl: url.href, token, method: 'PUT', resumableEndpoint: `${this.#url.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable/sign`, tusChunkBytes: STORAGE_TUS_CHUNK_BYTES, appExpiresAt: input.appExpiresAt, storageExpiresAt, safeCleanupAfter: Math.max(now + 24 * 3600_000, storageExpiresAt) + 5 * 60_000, expectedBytes: input.expectedBytes, bucketMaxBytes: MAX_FILE_BYTES };
  }
  async inspect(key: string): Promise<StorageObject> {
    const info = object(await this.#json(`/object/info/authenticated/${this.#objectPath(key)}`));
    if (info.name !== key || info.bucket_id !== this.#bucket || !safeId(info.id) || !safeId(info.version) || !integer(info.size, 1, MAX_FILE_BYTES) || typeof info.content_type !== 'string' || info.content_type.length > 256) throw new StorageError('PROTOCOL');
    return { key, id: info.id, version: info.version, bytes: info.size, contentType: info.content_type, etag: normalizeEtag(info.etag) };
  }
  async readSnapshot(key: string): Promise<{ object: StorageObject; bytes: Buffer; sha256: string }> {
    const before = await this.inspect(key);
    const bytes = await this.#request(`/object/authenticated/${this.#objectPath(key)}`, 'GET', async response => {
      if (response.status !== 200 || normalizeEtag(response.headers.get('etag')) !== before.etag) { await response.body?.cancel(); throw new StorageError('INTEGRITY'); }
      return boundedBody(response, before.bytes);
    }, undefined, { 'if-match': before.etag, 'cache-control': 'no-cache' });
    if (bytes.length !== before.bytes || !sameObject(before, await this.inspect(key))) throw new StorageError('INTEGRITY');
    return { object: before, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  /** Persist finalKey in a pending DB receipt BEFORE this call. No retries/deletion on an ambiguous mutation. */
  async promoteVerified(input: { stagingKey: string; finalKey: string; originalName: string; declaredMime: string; expectedBytes: number }): Promise<VerifiedObject> {
    this.#key(input.stagingKey, 'staging'); this.#key(input.finalKey, 'final');
    if (!integer(input.expectedBytes, 1, MAX_FILE_BYTES)) throw new StorageError('INVALID_INPUT');
    const snapshot = await this.readSnapshot(input.stagingKey);
    if (snapshot.bytes.length !== input.expectedBytes) throw new StorageError('INTEGRITY');
    const verified = validateFile(input.originalName, input.declaredMime, snapshot.bytes);
    // Copy the measured immutable snapshot, not a mutable source path. Never upsert a final object.
    await this.#request(`/object/${this.#objectPath(input.finalKey)}`, 'POST', async r => { await boundedBody(r, JSON_LIMIT); }, snapshot.bytes, { 'content-type': verified.mime, 'x-upsert': 'false', 'cache-control': 'no-store' });
    const final = await this.readSnapshot(input.finalKey);
    if (final.sha256 !== snapshot.sha256 || final.bytes.length !== snapshot.bytes.length) throw new StorageError('INTEGRITY');
    return { ...final.object, sha256: final.sha256, originalName: verified.name, mime: verified.mime, preview: verified.preview };
  }
  /** Each call is one <=4MiB chunk. Caller rechecks current ACL before and after each call. */
  async createGeneratedPart(input: { key: string; bytes: Buffer; filename: string; sha256: string }): Promise<VerifiedObject> {
    this.#key(input.key, 'final');
    if (!integer(input.bytes.length, 1, STORAGE_CHUNK_BYTES) || !/^[A-Za-z0-9_-]+\.xlsx$/.test(input.filename) || input.filename.length > 240 || createHash('sha256').update(input.bytes).digest('hex') !== input.sha256) throw new StorageError('INVALID_INPUT');
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await this.#request(`/object/${this.#objectPath(input.key)}`, 'POST', async r => { await boundedBody(r, JSON_LIMIT); }, input.bytes, { 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'no-store' });
    const final = await this.readSnapshot(input.key);
    if (final.sha256 !== input.sha256 || final.bytes.length !== input.bytes.length) throw new StorageError('INTEGRITY');
    return { ...final.object, sha256: final.sha256, originalName: input.filename, mime, preview: false };
  }
  /** Each call is one <=4MiB chunk. Caller rechecks current ACL before and after each call. */
  async readRange(expected: StorageObject, start: number, end: number): Promise<Buffer> {
    this.#key(expected.key, 'final');
    if (!integer(start, 0, expected.bytes - 1) || !integer(end, start, expected.bytes - 1) || end - start + 1 > STORAGE_CHUNK_BYTES) throw new StorageError('INVALID_INPUT');
    if (!sameObject(expected, await this.inspect(expected.key))) throw new StorageError('INTEGRITY');
    const bytes = await this.#request(`/object/authenticated/${this.#objectPath(expected.key)}`, 'GET', async response => {
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${expected.bytes}` || normalizeEtag(response.headers.get('etag')) !== expected.etag) { await response.body?.cancel(); throw new StorageError('INTEGRITY'); }
      return boundedBody(response, end - start + 1);
    }, undefined, { range: `bytes=${start}-${end}`, 'if-match': expected.etag, 'cache-control': 'no-cache' });
    if (bytes.length !== end - start + 1 || !sameObject(expected, await this.inspect(expected.key))) throw new StorageError('INTEGRITY');
    return bytes;
  }
  /** Requires an exclusive shared-DB cleanup claim; never use this to remove finalized records. */
  async cleanupExpiredStaging(expected: StorageObject, safeCleanupAfter: number, now = Date.now()): Promise<void> {
    this.#key(expected.key, 'staging');
    if (!integer(safeCleanupAfter, 1, Number.MAX_SAFE_INTEGER) || now <= safeCleanupAfter) throw new StorageError('NOT_EXPIRED');
    if (!sameObject(expected, await this.inspect(expected.key))) throw new StorageError('INTEGRITY');
    // Version-addressed delete. Unsupported deployments fail closed: NO path-only fallback.
    await this.#json(`/object/${this.#bucket}`, 'DELETE', { prefixes: [{ path: expected.key, versionId: expected.version }] });
  }
}
