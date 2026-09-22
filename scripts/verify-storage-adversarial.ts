/** Synthetic-only race/capability probes; no real application acceptance is implied. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { SupabasePrivateStorage, StorageError } from '../src/server/storage/supabase';
const envPath = process.env.STORAGE_PROBE_ENV_FILE, dir = process.env.STORAGE_PROBE_EVIDENCE_DIR;
if (!envPath || !path.isAbsolute(envPath) || !dir || !path.isAbsolute(dir)) throw new Error('Absolute private env and evidence paths required.');
const env = parseEnv(await readFile(envPath, 'utf8'));
const config = { projectUrl: new URL(env.SUPABASE_URL || '').origin, secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', bucket: env.SUPABASE_STORAGE_BUCKET || 'gs-hale-private', namespace: 'sb_storage_foundation_20260922' };
const storage = new SupabasePrivateStorage(config), owned: string[] = [], pendingTus: { url: string; token: string }[] = [];
const results: { name: string; status: 'PASS' | 'FAIL'; details?: Record<string, string | number | boolean> }[] = [];
const bytes = Buffer.from('name,value\nsynthetic,1\n'), changed = Buffer.from('name,value\nsynthetic,2\n');
const assert = (v: unknown) => { if (!v) throw new Error('Probe assertion failed'); };
const safeFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
const cancel = async (r: Response) => { const code = r.status; await r.body?.cancel(); return code; };
const server = async (p: string, method: string, body: Uint8Array | string, type: string) => safeFetch(`${config.projectUrl}/storage/v1${p}`, { method, body: body as BodyInit, headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, 'content-type': type, 'x-upsert': 'true' } });
async function check(name: string, action: () => Promise<Record<string, string | number | boolean> | void>) {
  try { results.push({ name, status: 'PASS', details: await action() || undefined }); }
  catch (e) { results.push({ name, status: 'FAIL', details: { code: e instanceof StorageError ? e.code : 'REDACTED_ERROR', ...(e instanceof StorageError && e.status ? { httpStatus: e.status } : {}) } }); }
}
async function setup() {
  const stagingKey = storage.allocateStagingKey(), finalKey = storage.allocateFinalKey(); owned.push(stagingKey, finalKey);
  const grant = await storage.issueUploadGrant({ key: stagingKey, expectedBytes: bytes.length, appExpiresAt: Date.now() + 600_000 });
  return { stagingKey, finalKey, grant };
}
async function upload(grant: Awaited<ReturnType<typeof storage.issueUploadGrant>>) { assert(await cancel(await safeFetch(grant.signedUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'text/csv' } })) === 200); }
async function tusCreate(grant: Awaited<ReturnType<typeof storage.issueUploadGrant>>, length: number, objectKey = grant.key) {
  const md = { bucketName: config.bucket, objectName: objectKey, contentType: 'text/csv', cacheControl: '0' };
  const r = await safeFetch(grant.resumableEndpoint, { method: 'POST', headers: { 'tus-resumable': '1.0.0', 'upload-length': String(length), 'upload-metadata': Object.entries(md).map(([k,v]) => `${k} ${Buffer.from(v).toString('base64')}`).join(','), 'x-signature': grant.token, 'x-upsert': 'true' } });
  const loc = r.headers.get('location'), code = await cancel(r);
  if (loc) { const resolved = new URL(loc, grant.resumableEndpoint); assert(resolved.origin === new URL(grant.resumableEndpoint).origin); pendingTus.push({ url: resolved.href, token: grant.token }); return { code, url: resolved.href }; }
  return { code, url: undefined };
}
try {
  await storage.ensurePrivateBucket();
  await check('late_tus_completion_cannot_overwrite_final', async () => {
    const { stagingKey, finalKey, grant } = await setup();
    const late = await tusCreate(grant, changed.length); assert(late.code === 201 && late.url);
    await upload(grant);
    const final = await storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: bytes.length });
    const code = await cancel(await safeFetch(late.url!, { method: 'PATCH', body: changed, headers: { 'tus-resumable': '1.0.0', 'upload-offset': '0', 'content-type': 'application/offset+octet-stream', 'x-signature': grant.token, 'x-upsert': 'true' } }));
    assert(code >= 400); assert((await storage.readSnapshot(finalKey)).sha256 === final.sha256); return { lateTusStatus: code, finalUnchanged: true };
  });
  await check('tus_token_final_path_substitution_rejected', async () => { const { finalKey, grant } = await setup(); const response = await tusCreate(grant, bytes.length, finalKey); assert(response.code >= 400); return { httpStatus: response.code }; });
  await check('tus_bucket_25mib_plus_one_rejected_at_creation', async () => { const { grant } = await setup(); const response = await tusCreate(grant, 25 * 1024 * 1024 + 1); assert(response.code >= 400); return { httpStatus: response.code }; });
  await check('real_staging_replacement_during_snapshot_rejected', async () => {
    const { stagingKey, grant } = await setup(); await upload(grant); let swapped = false;
    const fetcher: typeof fetch = async (input, init) => {
      const r = await fetch(input, init);
      if (!swapped && new URL(String(input)).pathname === `/storage/v1/object/authenticated/${config.bucket}/${stagingKey}`) {
        swapped = true; assert(await cancel(await server(`/object/${config.bucket}/${stagingKey}`, 'POST', changed, 'text/csv')) === 200);
      }
      return r;
    };
    let rejected = false;
    try { await new SupabasePrivateStorage(config, fetcher).readSnapshot(stagingKey); } catch (e) { rejected = e instanceof StorageError && e.code === 'INTEGRITY'; }
    assert(swapped && rejected); return { replacementPerformed: true, unverifiedBytesReturned: false };
  });
  await check('exact_old_version_delete_preserves_concurrent_replacement', async () => {
    const { stagingKey, grant } = await setup(); await upload(grant); const before = await storage.inspect(stagingKey);
    assert(await cancel(await server(`/object/${config.bucket}/${stagingKey}`, 'POST', changed, 'text/csv')) === 200);
    const code = await cancel(await server(`/object/${config.bucket}`, 'DELETE', JSON.stringify({ prefixes: [{ path: stagingKey, versionId: before.version }] }), 'application/json'));
    assert(code === 200); assert((await storage.readSnapshot(stagingKey)).bytes.equals(changed));
    let rejected = false; try { await storage.cleanupExpiredStaging(before, 1, 2); } catch (e) { rejected = e instanceof StorageError && e.code === 'INTEGRITY'; }
    assert(rejected); return { httpStatus: code, newerVersionPreserved: true };
  });
  await check('same_content_new_final_version_rejects_old_range_descriptor', async () => {
    const { stagingKey, finalKey, grant } = await setup(); await upload(grant); const final = await storage.promoteVerified({ stagingKey, finalKey, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: bytes.length });
    // Same-byte upsert can retain the provider version. Establish a genuinely new
    // owned object before testing the old descriptor; product transport never deletes final keys.
    assert(owned.includes(finalKey) && finalKey.startsWith(`${config.namespace}/final/`));
    const deletionStatus = await cancel(await server(`/object/${config.bucket}`, 'DELETE', JSON.stringify({ prefixes: [{ path: finalKey, versionId: final.version }] }), 'application/json'));
    assert(deletionStatus === 200);
    const absent = await safeFetch(`${config.projectUrl}/storage/v1/object/info/authenticated/${config.bucket}/${finalKey}`, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } });
    const absenceStatus = absent.status;
    // Storage can encode object-not-found as HTTP400 + statusCode404. Do not count arbitrary failures as absence.
    const absenceBody: unknown = await absent.json();
    assert(absenceStatus === 404 || (absenceStatus === 400 && !!absenceBody && typeof absenceBody === 'object' && 'statusCode' in absenceBody && String(absenceBody.statusCode) === '404'));
    const replacementStatus = await cancel(await server(`/object/${config.bucket}/${finalKey}`, 'POST', bytes, 'text/csv'));
    assert(replacementStatus === 200);
    const current = await storage.inspect(finalKey), snapshot = await storage.readSnapshot(finalKey);
    assert(current.id !== final.id && current.version !== final.version);
    assert(current.bytes === final.bytes && current.etag === final.etag && snapshot.sha256 === final.sha256 && snapshot.bytes.equals(bytes));
    let rejected = false; try { await storage.readRange(final, 0, 1); } catch (e) { rejected = e instanceof StorageError && e.code === 'INTEGRITY'; }
    assert(rejected); return { privilegedSyntheticMutation: true, deletionStatus, absenceStatus, absenceConfirmed: true, replacementStatus, idChanged: true, versionChanged: true, bytesUnchanged: true, sha256Unchanged: true, etagUnchanged: true, staleRangeRejected: true };
  });
} catch (e) { results.push({ name: 'probe_setup', status: 'FAIL', details: { code: e instanceof StorageError ? e.code : 'REDACTED_ERROR' } }); }
finally {
  await check('owned_tus_and_objects_cleanup', async () => {
    let tusCancelled = 0;
    for (const item of pendingTus) { const code = await cancel(await safeFetch(item.url, { method: 'DELETE', headers: { 'tus-resumable': '1.0.0', 'x-signature': item.token } })); if ([204,404,410].includes(code)) tusCancelled++; }
    assert(tusCancelled === pendingTus.length);
    if (owned.length) { assert(owned.every(k => k.startsWith(`${config.namespace}/`))); assert(await cancel(await server(`/object/${config.bucket}`, 'DELETE', JSON.stringify({ prefixes: owned }), 'application/json')) === 200); }
    return { exactOwnedKeys: owned.length, tusResources: pendingTus.length, tusCancelled };
  });
  const counts = { pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, skip: 0, not_run: 0 };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const evidence = path.join(dir, `actual-adversarial-${randomUUID()}.json`);
  await writeFile(evidence, JSON.stringify({ cwd: process.cwd(), completedAt: new Date().toISOString(), counts, results, syntheticOnly: true, fullApplicationAcceptance: 'NOT_RUN' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence, counts })); if (counts.fail) process.exitCode = 1;
}
