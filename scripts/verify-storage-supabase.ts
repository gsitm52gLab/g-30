/** Actual Storage probe, synthetic owned prefix only. Never prints credentials or remote response bodies. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { SupabasePrivateStorage, StorageError, STORAGE_CHUNK_BYTES, STORAGE_TUS_CHUNK_BYTES } from '../src/server/storage/supabase';

const envPath = process.env.STORAGE_PROBE_ENV_FILE;
const evidenceDir = process.env.STORAGE_PROBE_EVIDENCE_DIR;
if (!envPath || !path.isAbsolute(envPath) || !evidenceDir || !path.isAbsolute(evidenceDir)) throw new Error('Absolute probe env/evidence paths required.');
const env = parseEnv(await readFile(envPath, 'utf8'));
const config = { projectUrl: new URL(env.SUPABASE_URL || '').origin, secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', bucket: env.SUPABASE_STORAGE_BUCKET || 'gs-hale-private', namespace: 'sb_storage_foundation_20260922', timeoutMs: 60_000 };
const storage = new SupabasePrivateStorage(config);
const runId = randomUUID();
const records: { name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN'; details?: Record<string, string | number | boolean> }[] = [];
const owned: string[] = [];
let bucketCreated = false;
async function check(name: string, fn: () => Promise<Record<string, string | number | boolean> | void>) {
  try { records.push({ name, status: 'PASS', details: await fn() || undefined }); }
  catch (e) { records.push({ name, status: 'FAIL', details: { code: e instanceof StorageError ? e.code : e instanceof Error && /^PROBE_[A-Z_]+$/.test(e.message) ? e.message : 'REDACTED_ERROR', ...(e instanceof StorageError && e.status ? { httpStatus: e.status } : {}) } }); }
}
function assert(value: unknown, message = 'PROBE_ASSERTION') { if (!value) throw new Error(message); }
async function raw(url: string, init: RequestInit = {}) { return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000) }); }
async function status(response: Response) { const code = response.status; await response.body?.cancel(); return code; }
async function tusCreate(grant: Awaited<ReturnType<typeof storage.issueUploadGrant>>, bytes: number, override?: string) {
  const metadata = { bucketName: grant.bucket, objectName: override || grant.key, contentType: 'text/csv', cacheControl: '0' };
  const r = await raw(grant.resumableEndpoint, { method: 'POST', headers: { 'tus-resumable': '1.0.0', 'upload-length': String(bytes), 'upload-metadata': Object.entries(metadata).map(([k,v]) => `${k} ${Buffer.from(v).toString('base64')}`).join(','), 'x-signature': grant.token } });
  const location = r.headers.get('location');
  const code = await status(r);
  if (code !== 201 || !location) throw new StorageError('PROTOCOL', code);
  const resolved = new URL(location, grant.resumableEndpoint);
  assert(resolved.origin === new URL(grant.resumableEndpoint).origin, 'PROBE_TUS_ORIGIN');
  return resolved.href;
}
async function tusPatch(url: string, token: string, offset: number, bytes: Buffer) {
  const r = await raw(url, { method: 'PATCH', body: bytes as BodyInit, headers: { 'tus-resumable': '1.0.0', 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream', 'x-signature': token } });
  const next = Number(r.headers.get('upload-offset')), code = await status(r);
  return { code, next };
}
try {
  await check('private_bucket_non_destructive_provision', async () => { const result = await storage.ensurePrivateBucket(); bucketCreated = result.created; return result; });
  assert(records.at(-1)?.status === 'PASS', 'PROBE_BUCKET_SETUP');
  const bytes = Buffer.from('synthetic,label\nGS_HALE,storage_probe\n');
  const stagingKey = storage.allocateStagingKey(), finalKey = storage.allocateFinalKey(); owned.push(stagingKey, finalKey);
  const grant = await storage.issueUploadGrant({ key: stagingKey, expectedBytes: bytes.length, appExpiresAt: Date.now() + 10 * 60_000 });
  await check('signed_grant_staging_and_provider_expiry', async () => ({ bucketMaxBytes: grant.bucketMaxBytes, appTtlSeconds: Math.round((grant.appExpiresAt - Date.now()) / 1000), providerTtlSeconds: Math.round((grant.storageExpiresAt - Date.now()) / 1000), stagingOnly: grant.key.includes('/staging/'), scopedTokenOnly: !grant.signedUrl.includes(config.secretKey) }));
  await check('direct_signed_upload_no_server_key', async () => { const code = await status(await raw(grant.signedUrl, { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': 'text/csv' } })); assert(code === 200); return { httpStatus: code }; });
  await check('signed_reuse_upsert_header_cannot_overwrite', async () => { const code = await status(await raw(grant.signedUrl, { method: 'PUT', body: Buffer.from('replacement'), headers: { 'content-type': 'text/csv', 'x-upsert': 'true' } })); assert(code >= 400); assert((await storage.readSnapshot(stagingKey)).bytes.equals(bytes)); return { httpStatus: code }; });
  const final = await storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: bytes.length });
  await check('snapshot_promoted_and_final_hash_verified', async () => { assert(final.sha256 === createHash('sha256').update(bytes).digest('hex')); assert(final.key !== stagingKey); return { bytes: final.bytes, separateFinalKey: true }; });
  await check('signed_path_substitution_cannot_write_final', async () => { const changed = grant.signedUrl.replace(stagingKey, finalKey); const code = await status(await raw(changed, { method: 'PUT', body: Buffer.from('replacement'), headers: { 'content-type': 'text/csv', 'x-upsert': 'true' } })); assert(code >= 400); assert((await storage.readSnapshot(finalKey)).sha256 === final.sha256); return { httpStatus: code }; });
  await check('anonymous_read_private_final_denied', async () => { const code = await status(await raw(`${config.projectUrl}/storage/v1/object/public/${config.bucket}/${finalKey}`)); assert(code >= 400); return { httpStatus: code }; });
  await check('repeated_final_promotion_cannot_overwrite', async () => { let denied = false; try { await storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: bytes.length }); } catch { denied = true; } assert(denied); assert((await storage.readSnapshot(finalKey)).sha256 === final.sha256); });
  await check('range_fixed_version_and_boundaries', async () => { assert((await storage.readRange(final, 0, bytes.length - 1)).equals(bytes)); assert((await storage.readRange(final, bytes.length - 1, bytes.length - 1)).equals(bytes.subarray(-1))); });
  await check('cleanup_live_grant_refused', async () => { let code = ''; try { await storage.cleanupExpiredStaging(await storage.inspect(stagingKey), grant.safeCleanupAfter); } catch (e) { code = e instanceof StorageError ? e.code : 'UNKNOWN'; } assert(code === 'NOT_EXPIRED'); });
  await check('version_addressed_delete_endpoint_capability', async () => {
    // Only a synthetic object owned by THIS run. Fake wall-clock expiration is capability testing, not production cleanup evidence.
    await storage.cleanupExpiredStaging(await storage.inspect(stagingKey), grant.safeCleanupAfter, grant.safeCleanupAfter + 1);
    const response = await raw(`${config.projectUrl}/storage/v1/object/info/authenticated/${config.bucket}/${stagingKey}`, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } });
    const code = await status(response); assert(code >= 400); return { exactVersionDeleteSupported: true };
  });
  await check('late_recreated_staging_does_not_change_final', async () => { const code = await status(await raw(grant.signedUrl, { method: 'PUT', body: Buffer.from('late,upload\n'), headers: { 'content-type': 'text/csv' } })); assert(code === 200 || code >= 400); assert((await storage.readSnapshot(finalKey)).sha256 === final.sha256); return { lateUploadHttpStatus: code }; });
  const large = Buffer.alloc(25 * 1024 * 1024, 97), largeKey = storage.allocateStagingKey(), largeFinalKey = storage.allocateFinalKey(); owned.push(largeKey, largeFinalKey);
  const largeGrant = await storage.issueUploadGrant({ key: largeKey, expectedBytes: large.length, appExpiresAt: Date.now() + 15 * 60_000 });
  await check('tus_25mib_pause_head_resume_no_server_key', async () => {
    const uploadUrl = await tusCreate(largeGrant, large.length);
    let offset = 0;
    while (offset < large.length) {
      const chunk = large.subarray(offset, Math.min(offset + STORAGE_TUS_CHUNK_BYTES, large.length));
      const patched = await tusPatch(uploadUrl, largeGrant.token, offset, chunk); assert(patched.code === 204 && patched.next === offset + chunk.length, 'PROBE_TUS_PATCH'); offset = patched.next;
      if (offset === STORAGE_TUS_CHUNK_BYTES) {
        const head = await raw(uploadUrl, { method: 'HEAD', headers: { 'tus-resumable': '1.0.0', 'x-signature': largeGrant.token } });
        assert(head.status === 200 && Number(head.headers.get('upload-offset')) === offset, 'PROBE_TUS_RESUME'); await head.body?.cancel();
      }
    }
    assert((await storage.inspect(largeKey)).bytes === large.length); return { bytes: large.length, chunks: Math.ceil(large.length / STORAGE_TUS_CHUNK_BYTES), resumedOffset: STORAGE_TUS_CHUNK_BYTES };
  });
  if (records.at(-1)?.status === 'PASS') {
    await check('25mib_finalize_and_chunked_roundtrip', async () => {
      const promoted = await storage.promoteVerified({ stagingKey: largeKey, finalKey: largeFinalKey, expectedBytes: large.length, originalName: 'synthetic-large.csv', declaredMime: 'text/csv' });
      const digest = createHash('sha256');
      let chunks = 0;
      for (let start = 0; start < large.length; start += STORAGE_CHUNK_BYTES) { digest.update(await storage.readRange(promoted, start, Math.min(start + STORAGE_CHUNK_BYTES - 1, large.length - 1))); chunks++; }
      assert(digest.digest('hex') === promoted.sha256); return { bytes: large.length, rangeChunks: chunks, chunkLimit: STORAGE_CHUNK_BYTES };
    });
  } else records.push({ name: '25mib_finalize_and_chunked_roundtrip', status: 'NOT_RUN' });
} catch (e) { records.push({ name: 'probe_execution', status: 'FAIL', details: { code: e instanceof StorageError ? e.code : 'REDACTED_ERROR', ...(e instanceof StorageError && e.status ? { httpStatus: e.status } : {}) } }); }
finally {
  // Exact keys generated in memory by this run only; never bucket deletion/prefix listing/unrelated cleanup.
  await check('owned_synthetic_cleanup', async () => {
    if (!owned.length) return { exactOwnedKeys: 0, bucketPreserved: true };
    assert(owned.every(k => new RegExp(`^${config.namespace}/(?:staging|final)/[a-f0-9-]{36}$`).test(k)));
    const code = await status(await raw(`${config.projectUrl}/storage/v1/object/${config.bucket}`, { method: 'DELETE', headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: owned }) }));
    assert(code === 200); return { exactOwnedKeys: owned.length, bucketPreserved: true };
  });
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const result = { runId, cwd: process.cwd(), completedAt: new Date().toISOString(), syntheticOnly: true, bucketCreated, credentialsPrinted: false, fullApplicationAcceptance: 'NOT_RUN', counts: { pass: records.filter(r => r.status === 'PASS').length, fail: records.filter(r => r.status === 'FAIL').length, not_run: records.filter(r => r.status === 'NOT_RUN').length, skip: 0 }, records };
  const output = path.join(evidenceDir, `actual-storage-${runId}.json`);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence: output, counts: result.counts, bucketCreated, fullApplicationAcceptance: 'NOT_RUN' }));
  if (result.counts.fail) process.exitCode = 1;
}
