import { describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { SupabasePrivateStorage, StorageError, STORAGE_CHUNK_BYTES } from '../../src/server/storage/supabase';
const config = { projectUrl: 'https://example.supabase.co', secretKey: 'sb_secret_synthetic_fixture_never_real', bucket: 'gs-hale-private', namespace: 'test_storage' };
const key = (lane = 'staging') => `${config.namespace}/${lane}/${randomUUID()}`;
const etag = (bytes: Buffer) => `"${createHash('md5').update(bytes).digest('hex')}"`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const objects = new Map<string, { bytes: Buffer; id: string; version: string; contentType: string }>();
  let bucket: unknown = { id: config.bucket, public: false, file_size_limit: 25 * 1024 * 1024, allowed_mime_types: null };
  const calls: { url: string; method: string; init: RequestInit }[] = [];
  const add = (k: string, bytes = Buffer.from('name,value\nsynthetic,1\n')) => { objects.set(k, { bytes, id: randomUUID(), version: randomUUID(), contentType: 'text/csv' }); return k; };
  let afterRead: (() => void) | undefined;
  const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), pathname = new URL(url).pathname.replace('/storage/v1', ''), method = init.method || 'GET'; calls.push({ url, method, init });
    if (pathname === `/bucket/${config.bucket}` && method === 'GET') return bucket ? json(bucket) : json({}, 400);
    if (pathname === '/bucket' && method === 'GET') return json(bucket ? [bucket] : []);
    if (pathname === '/bucket' && method === 'POST') { bucket = { ...JSON.parse(String(init.body)) }; return json({ name: config.bucket }); }
    const signed = `/object/upload/sign/${config.bucket}/`;
    if (pathname.startsWith(signed)) {
      const k = pathname.slice(signed.length);
      const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ url: `${config.bucket}/${k}`, upsert: false, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url'), 'synthetic_signature'].join('.');
      return json({ url: `${pathname}?token=${token}` });
    }
    const info = `/object/info/authenticated/${config.bucket}/`;
    if (pathname.startsWith(info)) {
      const k = pathname.slice(info.length), o = objects.get(k);
      return o ? json({ name: k, bucket_id: config.bucket, id: o.id, version: o.version, size: o.bytes.length, etag: etag(o.bytes), content_type: o.contentType }) : json({}, 404);
    }
    const get = `/object/authenticated/${config.bucket}/`;
    if (pathname.startsWith(get)) {
      const o = objects.get(pathname.slice(get.length));
      if (!o) return json({}, 404);
      const h = new Headers(init.headers), range = h.get('range');
      const bytes = Buffer.from(o.bytes), tag = etag(bytes);
      if (h.get('if-match') !== tag) return json({}, 412);
      afterRead?.();
      if (range) {
        const [, start, end] = range.match(/^bytes=(\d+)-(\d+)$/)!;
        return new Response(bytes.subarray(Number(start), Number(end) + 1), { status: 206, headers: { etag: tag, 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
      }
      return new Response(bytes, { headers: { etag: tag } });
    }
    if (pathname === `/object/${config.bucket}` && method === 'DELETE') {
      const p = JSON.parse(String(init.body)).prefixes[0];
      if (objects.get(p.path)?.version === p.versionId) objects.delete(p.path);
      return json([]);
    }
    const upload = `/object/${config.bucket}/`;
    if (pathname.startsWith(upload) && method === 'POST') {
      const k = pathname.slice(upload.length);
      if (objects.has(k)) return json({}, 409);
      add(k, Buffer.from(init.body as Uint8Array)); return json({ Key: k });
    }
    throw new Error('Unexpected synthetic request');
  }) as unknown as typeof fetch;
  return { objects, add, calls, fetcher, setBucket: (v: unknown) => { bucket = v; }, afterRead: (fn: () => void) => { afterRead = fn; } };
}
async function promoted(f = fixture()) {
  const storage = new SupabasePrivateStorage(config, f.fetcher), stagingKey = f.add(key()), finalKey = storage.allocateFinalKey();
  const result = await storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: f.objects.get(stagingKey)!.bytes.length });
  return { f, storage, stagingKey, finalKey, result };
}
describe('Supabase private storage transport', () => {
  it.each(['http://example.supabase.co', 'https://evil.test', 'https://x.supabase.co/a', 'https://x.supabase.co/?secret=a', 'https://user:pass@x.supabase.co'])('rejects unsafe server URL %s', url => { expect(() => new SupabasePrivateStorage({ ...config, projectUrl: url })).toThrow(StorageError); });
  it('normalizes only the known Supabase dashboard API URL forms', async () => { const f = fixture(); await new SupabasePrivateStorage({ ...config, projectUrl: `${config.projectUrl}/rest/v1/` }, f.fetcher).ensurePrivateBucket(); expect(f.calls[0].url).toBe(`${config.projectUrl}/storage/v1/bucket/${config.bucket}`); });
  it('rejects browser keys and unsafe namespace without network or revealing secret', () => { expect(() => new SupabasePrivateStorage({ ...config, secretKey: 'sb_publishable_fake' })).toThrow('CONFIG'); expect(() => new SupabasePrivateStorage({ ...config, namespace: '../outside' })).toThrow('CONFIG'); expect(JSON.stringify(new SupabasePrivateStorage(config))).toBe('{}'); });
  it('verifies existing private bucket without mutation', async () => { const f = fixture(); expect(await new SupabasePrivateStorage(config, f.fetcher).ensurePrivateBucket()).toEqual({ created: false }); expect(f.calls.map(c => c.method)).toEqual(['GET']); });
  it('creates only an absent bucket with 25MiB limit and keeps it private', async () => { const f = fixture(); f.setBucket(null); expect(await new SupabasePrivateStorage(config, f.fetcher).ensurePrivateBucket()).toEqual({ created: true }); expect(JSON.parse(String(f.calls.find(c => c.method === 'POST')?.init.body))).toMatchObject({ public: false, file_size_limit: 25 * 1024 * 1024 }); });
  it.each([{ public: true, file_size_limit: 25 * 1024 * 1024 }, { public: false, file_size_limit: null }, { public: false, file_size_limit: 1024 }, { public: false, file_size_limit: 25 * 1024 * 1024, allowed_mime_types: ['image/png'] }])('never alters incompatible existing bucket %j', async invalid => { const f = fixture(); f.setBucket({ id: config.bucket, ...invalid }); await expect(new SupabasePrivateStorage(config, f.fetcher).ensurePrivateBucket()).rejects.toMatchObject({ code: 'BUCKET_POLICY' }); expect(f.calls).toHaveLength(1); });
  it('only grants random owned staging paths; never final or traversal', async () => { const f = fixture(), s = new SupabasePrivateStorage(config, f.fetcher); for (const k of [key('final'), '../x', `outside/staging/${randomUUID()}`, `${config.namespace}/staging/fake`]) await expect(s.issueUploadGrant({ key: k, expectedBytes: 10, appExpiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(f.calls).toHaveLength(0); });
  it('reports provider expiry separately and disables upsert without returning the server key', async () => { const f = fixture(), s = new SupabasePrivateStorage(config, f.fetcher), now = Date.now(); const grant = await s.issueUploadGrant({ key: s.allocateStagingKey(), expectedBytes: 25 * 1024 * 1024, appExpiresAt: now + 60_000 }); expect(grant.storageExpiresAt).toBeGreaterThan(grant.appExpiresAt); expect(grant.safeCleanupAfter).toBeGreaterThan(now + 24 * 3600_000); expect(JSON.stringify(grant)).not.toContain(config.secretKey); expect(new Headers(f.calls[0].init.headers).get('x-upsert')).toBe('false'); });
  it.each([0, -1, NaN, 25 * 1024 * 1024 + 1])('rejects invalid grant bytes %s', async bytes => { const f = fixture(); await expect(new SupabasePrivateStorage(config, f.fetcher).issueUploadGrant({ key: key(), expectedBytes: bytes, appExpiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(f.calls).toHaveLength(0); });
  it('rejects stale and unbounded app deadlines', async () => { const s = new SupabasePrivateStorage(config, fixture().fetcher); for (const offset of [-1, 16 * 60_000]) await expect(s.issueUploadGrant({ key: key(), expectedBytes: 1, appExpiresAt: Date.now() + offset })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); });
  it('rejects a provider upload token for a different object', async () => { const f = fixture(), other = new SupabasePrivateStorage(config, f.fetcher); const grant = await other.issueUploadGrant({ key: key(), expectedBytes: 1, appExpiresAt: Date.now() + 60_000 }); const fetcher = vi.fn(async () => json({ url: new URL(grant.signedUrl).pathname.replace('/storage/v1','') + new URL(grant.signedUrl).search })); const s = new SupabasePrivateStorage(config, fetcher); await expect(s.issueUploadGrant({ key: key(), expectedBytes: 1, appExpiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: 'PROTOCOL' }); });
  it('rejects a remote redirect without forwarding the credential', async () => { const f = vi.fn(async () => { throw new Error(`Bearer ${config.secretKey}`); }); const s = new SupabasePrivateStorage({ ...config, readRetries: 0 }, f); await expect(s.inspect(key())).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Storage operation failed (UNAVAILABLE).' }); expect(f.mock.calls).toHaveLength(1); });
  it('bounds GET retries and has no mutation retry', async () => { const f = vi.fn(async () => json({ secret: config.secretKey }, 503)); const s = new SupabasePrivateStorage(config, f); await expect(s.inspect(key())).rejects.toMatchObject({ code: 'UNAVAILABLE', outcome: 'unchanged' }); expect(f).toHaveBeenCalledTimes(2); f.mockClear(); await expect(s.issueUploadGrant({ key: key(), expectedBytes: 1, appExpiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ outcome: 'unknown' }); expect(f).toHaveBeenCalledTimes(1); });
  it('times out a real pending fetch and redacts the transport error', async () => { const fetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error(config.secretKey))); }); const s = new SupabasePrivateStorage({ ...config, timeoutMs: 50, readRetries: 0 }, fetcher); await expect(s.inspect(key())).rejects.toMatchObject({ code: 'TIMEOUT' }); });
  it('bounds simultaneous requests without pretending to be a distributed lock', async () => { let resolve!: (r: Response) => void; const f: typeof fetch = () => new Promise(r => { resolve = r; }); const s = new SupabasePrivateStorage({ ...config, maxConcurrentRequests: 1, readRetries: 0 }, f); const pending = s.inspect(key()).catch(e => e); await expect(s.inspect(key())).rejects.toMatchObject({ code: 'BUSY' }); resolve(json({}, 404)); await pending; });
  it('rejects oversized control responses before parsing', async () => { const s = new SupabasePrivateStorage(config, async () => new Response('x', { headers: { 'content-length': '999999999' } })); await expect(s.inspect(key())).rejects.toMatchObject({ code: 'TOO_LARGE' }); });
  it('measures SHA256 and rejects replacement during snapshot read', async () => { const f = fixture(), k = f.add(key()); f.afterRead(() => f.add(k, Buffer.from('replacement'))); await expect(new SupabasePrivateStorage(config, f.fetcher).readSnapshot(k)).rejects.toMatchObject({ code: 'INTEGRITY' }); });
  it('preserves verified bytes under an independent final create-only key', async () => { const { f, storage, result, stagingKey } = await promoted(); expect(result.sha256).toBe(createHash('sha256').update(f.objects.get(stagingKey)!.bytes).digest('hex')); const upload = f.calls.find(c => c.method === 'POST')!; expect(new Headers(upload.init.headers).get('x-upsert')).toBe('false'); f.add(stagingKey, Buffer.from('late upload')); expect((await storage.readSnapshot(result.key)).sha256).toBe(result.sha256); });
  it('rejects expected byte mismatch and invalid signature before writing final', async () => { const f = fixture(), s = new SupabasePrivateStorage(config, f.fetcher), stagingKey = f.add(key()); await expect(s.promoteVerified({ stagingKey, finalKey: key('final'), originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: 1 })).rejects.toMatchObject({ code: 'INTEGRITY' }); await expect(s.promoteVerified({ stagingKey, finalKey: key('final'), originalName: 'fake.pdf', declaredMime: 'application/pdf', expectedBytes: f.objects.get(stagingKey)!.bytes.length })).rejects.toMatchObject({ code: 'VALIDATION' }); expect(f.calls.some(c => c.method === 'POST')).toBe(false); });
  it('does not overwrite an already finalized object on duplicate promotion', async () => { const { f, storage, stagingKey, finalKey, result } = await promoted(); await expect(storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: result.bytes })).rejects.toMatchObject({ code: 'CONFLICT' }); expect(f.objects.get(finalKey)?.version).toBe(result.version); });
  it('returns only exact validated bounded byte ranges of the fixed version', async () => { const { f, storage, result } = await promoted(); expect(await storage.readRange(result, 0, 4)).toEqual(f.objects.get(result.key)!.bytes.subarray(0,5)); await expect(storage.readRange(result, -1, 3)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); await expect(storage.readRange(result, 0, STORAGE_CHUNK_BYTES)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); f.add(result.key); await expect(storage.readRange(result, 0, 4)).rejects.toMatchObject({ code: 'INTEGRITY' }); });
  it('refuses a stale descriptor even when same-content bytes have a new object version', async () => { const { f, storage, result } = await promoted(); f.objects.get(result.key)!.version = randomUUID(); await expect(storage.readRange(result, 0, 1)).rejects.toMatchObject({ code: 'INTEGRITY' }); });
  it('cleanup rejects final objects, live grants and concurrent staging replacement', async () => { const { f, storage, stagingKey, result } = await promoted(); const staging = await storage.inspect(stagingKey); await expect(storage.cleanupExpiredStaging(result, 1, 2)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); await expect(storage.cleanupExpiredStaging(staging, Date.now() + 1000)).rejects.toMatchObject({ code: 'NOT_EXPIRED' }); f.add(stagingKey); await expect(storage.cleanupExpiredStaging(staging, 1, 2)).rejects.toMatchObject({ code: 'INTEGRITY' }); expect(f.calls.some(c => c.method === 'DELETE')).toBe(false); });
  it('cleanup sends exact version only with no unguarded path fallback', async () => { const f = fixture(), s = new SupabasePrivateStorage(config, f.fetcher), k = f.add(key()), descriptor = await s.inspect(k); await s.cleanupExpiredStaging(descriptor, 1, 2); expect(f.objects.has(k)).toBe(false); expect(JSON.parse(String(f.calls.at(-1)!.init.body))).toEqual({ prefixes: [{ path: k, versionId: descriptor.version }] }); });
  it('keeps a created final object recoverable after mutation response is lost, without retry or cleanup', async () => {
    const f = fixture(), stagingKey = f.add(key()), finalKey = key('final'); let mutationCalls = 0;
    const wrapped: typeof fetch = async (input, init) => {
      const r = await f.fetcher(input, init);
      if (init?.method === 'POST' && String(input).includes('/object/' + config.bucket + '/')) { mutationCalls++; throw new Error('response lost'); }
      return r;
    };
    const s = new SupabasePrivateStorage(config, wrapped);
    await expect(s.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: f.objects.get(stagingKey)!.bytes.length })).rejects.toMatchObject({ code: 'UNAVAILABLE', outcome: 'unknown' });
    expect(mutationCalls).toBe(1); expect(f.objects.has(finalKey)).toBe(true);
    expect((await s.readSnapshot(finalKey)).bytes).toEqual(f.objects.get(stagingKey)!.bytes);
    expect(f.calls.some(c => c.method === 'DELETE')).toBe(false);
  });
  it('rechecks final bytes after upload and refuses a substituted object', async () => {
    const f = fixture(), stagingKey = f.add(key()), finalKey = key('final');
    const wrapped: typeof fetch = async (input, init) => {
      const r = await f.fetcher(input, init);
      if (init?.method === 'POST') f.add(finalKey, Buffer.from('substituted'));
      return r;
    };
    await expect(new SupabasePrivateStorage(config, wrapped).promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: f.objects.get(stagingKey)!.bytes.length })).rejects.toMatchObject({ code: 'INTEGRITY' });
  });
  it('rejects incorrect Range responses instead of exposing unverified bytes', async () => {
    const { f, result } = await promoted();
    const wrapped: typeof fetch = async (input, init) => new Headers(init?.headers).has('range') ? new Response('x', { status: 200, headers: { etag: result.etag } }) : f.fetcher(input, init);
    await expect(new SupabasePrivateStorage(config, wrapped).readRange(result, 0, 0)).rejects.toMatchObject({ code: 'INTEGRITY' });
  });
  it('does not fall back to unsafe delete if exact-version deletion is unsupported', async () => {
    const f = fixture(), k = f.add(key());
    const wrapped: typeof fetch = async (input, init) => init?.method === 'DELETE' ? json({}, 400) : f.fetcher(input, init);
    const spy = vi.fn(wrapped), s = new SupabasePrivateStorage(config, spy), o = await s.inspect(k);
    await expect(s.cleanupExpiredStaging(o, 1, 2)).rejects.toMatchObject({ status: 400 });
    expect(spy.mock.calls.filter(c => c[1]?.method === 'DELETE')).toHaveLength(1); expect(f.objects.has(k)).toBe(true);
  });

});
