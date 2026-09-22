/** S1 actual private Storage + PostgreSQL probe. Exact new fixture objects/schema only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { parsePostgresConfig, quoteSchema } from '@/server/postgres/config';
import { createPostgresRepository } from '@/server/postgres/repository';
import { createPostgresPool, connect } from '@/server/postgres/client';
import { migratePostgres } from '@/server/postgres/migrate';
import { SupabasePrivateStorage, StorageError } from '@/server/storage/supabase';
import { StorageCore } from '@/server/storage/core';
import { SharedImportStaging } from '@/server/storage/staging';
import { StorageCoreError, type StorageTransport } from '@/server/storage/contracts';
import { STORAGE_LIMITS, type UploadInput } from '@/domain/storage/types';
import { digest } from '@/domain/storage/validate';
import { createFixture, fixtureIds, adapters } from './verify-storage-app-shared';
import type { RecordRepository } from '@/domain/records';
const [envFile, outputFile, mode = 'main', childRunId, childGrantId] = process.argv.slice(2);
if (!envFile?.startsWith('/') || !outputFile?.startsWith('/')) throw Error('Absolute env and new output paths required');
const envBytes = readFileSync(envFile), envHash = digest(envBytes), env = parseEnv(envBytes.toString());
const targetSchema = process.env.STORAGE_APP_SCHEMA || 'gs_hale_storage_core_20260922';
if (!/^gs_hale_storage_(?:core|ind)_[a-z0-9_]{1,35}$/.test(targetSchema)) throw Error('Dedicated Storage test schema required');
const config = parsePostgresConfig({ ...env, SUPABASE_DB_SCHEMA: targetSchema }, 'migration');
const runId = mode === 'recover' ? childRunId : randomUUID(), f = fixtureIds(runId);
const namespace = `storage_core_${runId.replaceAll('-', '')}`;
const storageConfig = { projectUrl: new URL(env.SUPABASE_URL || '').origin, secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', bucket: env.SUPABASE_STORAGE_BUCKET || 'gs-hale-private', namespace, timeoutMs: 120_000 };
const remote = new SupabasePrivateStorage(storageConfig), clock = () => new Date().toISOString();
const repo = createPostgresRepository(config), other = createPostgresRepository(config);
const owned = new Set<string>(); let promotions = 0;
function transport(overrides: Partial<StorageTransport> = {}): StorageTransport {
  return {
    allocateStagingKey: () => { const key = remote.allocateStagingKey(); owned.add(key); return key; },
    allocateFinalKey: () => { const key = remote.allocateFinalKey(); owned.add(key); return key; },
    issueUploadGrant: remote.issueUploadGrant.bind(remote), inspect: remote.inspect.bind(remote), readSnapshot: remote.readSnapshot.bind(remote), readRange: remote.readRange.bind(remote), cleanupExpiredStaging: remote.cleanupExpiredStaging.bind(remote),
    promoteVerified: async input => { promotions++; return remote.promoteVerified(input); }, ...overrides,
  };
}
let rollback = false;
const a = adapters(repo, runId, clock, () => { if (rollback) throw new Error('SYNTHETIC_COMMIT_ROLLBACK'); });
const core = new StorageCore(repo, () => transport(), a.hooks, clock);
if (mode === 'recover') {
  try {
    const recovered = await core.finalize(f.token, childGrantId);
    writeFileSync(outputFile, JSON.stringify({ pid: process.pid, status: recovered.state, record: recovered.result, promotions, candidate_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }, null, 2), { flag: 'wx', mode: 0o600 });
  } finally { await repo.close(); await other.close(); }
} else {
  const planned = 16;
  const checks: { name: string; status: 'PASS' | 'FAIL'; code?: string; details?: Record<string, unknown> }[] = [];
  const report = { candidate_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cwd: process.cwd(), pid: process.pid, runId, schema: config.schema, started_at: clock(), checks, counts: { pass: 0, fail: 0, skip: 0, not_run: planned }, env_unchanged: false, actual_storage_http: 'EXECUTED; individual HTTP count not instrumented', ai_provider_calls: 0, browser_app_integration: 'NOT_RUN', private_paths_or_tokens_logged: false };
  writeFileSync(outputFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  function save() { report.counts.not_run = Math.max(0, planned - checks.filter(c => c.name !== 'execution prerequisite').length); report.counts.pass = checks.filter(c => c.status === 'PASS').length; report.counts.fail = checks.filter(c => c.status === 'FAIL').length; writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  async function check(name: string, operation: () => Promise<Record<string, unknown> | void>) {
    try { checks.push({ name, status: 'PASS', details: await operation() || undefined }); }
    catch (e) { const code = e instanceof StorageError || e instanceof StorageCoreError ? e.code : e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(e.code) ? e.code : 'ASSERTION_OR_UNCLASSIFIED'; checks.push({ name, status: 'FAIL', code }); }
    save(); console.log(JSON.stringify({ name, ...checks.at(-1), counts: report.counts }));
  }
  const bytes = Buffer.from('synthetic,value\nSTORAGE_S1,1\n');
  const input = (label: string, content = bytes): UploadInput => ({ contextId: f.contextId, owner: { purpose: 'task_reference', taskId: f.taskId }, visibility: 'public', clientItemId: label, originalName: 'synthetic.csv', declaredMime: 'text/csv', expectedBytes: content.length, expectedSha256: digest(content) });
  async function uploaded(label: string, content = bytes) {
    const issued = await core.issue(f.token, input(label, content)); assert(issued.capability);
    const r = await fetch(issued.capability.signedUrl, { method: 'PUT', body: content as BodyInit, headers: { 'content-type': 'text/csv' }, signal: AbortSignal.timeout(120_000) });
    const status = r.status; await r.body?.cancel(); assert.equal(status, 200); return issued.status.id;
  }
  const pool = createPostgresPool(config, 'migration'), schema = quoteSchema(config.schema);
  const sql = async (query: string, args: unknown[] = []) => { const c = await connect(pool); try { return await c.query(query, args); } finally { c.release(); } };
  let originalCount = 0, originalHash = '', historyCount = 0;
  try {
    await check('PG01 read-only target inventory before any mutation', async () => {
      const exists = (await sql('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS yes', [config.schema])).rows[0].yes;
      if (exists) { const rows = (await sql(`SELECT * FROM ${schema}.records ORDER BY kind,id`)).rows; originalCount = rows.length; originalHash = digest(JSON.stringify(rows)); historyCount = Number((await sql(`SELECT count(*) AS count FROM ${schema}.schema_migrations`)).rows[0].count); }
      return { targetPreviouslyExisted: exists, originalCount, originalHash, historyCount };
    });
    await check('PG02 fresh additive migration19, exact existing rows and repeat0', async () => {
      const migration = await migratePostgres(config); assert.equal(migration.total, 19); assert.equal(migration.applied, 19 - historyCount);
      const rows = (await sql(`SELECT * FROM ${schema}.records ORDER BY kind,id`)).rows; assert.equal(rows.length, originalCount); if (originalCount) assert.equal(digest(JSON.stringify(rows)), originalHash);
      assert.equal((await migratePostgres(config)).applied, 0); return { applied: migration.applied, total: migration.total, repeat: 0 };
    });
    if (report.counts.fail) throw Error('setup failed');
    await createFixture(repo, runId, clock);
    await check('S01 existing private bucket verified without mutation', async () => { const result = await remote.ensurePrivateBucket(); assert.equal(result.created, false); return result; });
    const issued = await core.issue(f.token, input('small'));
    await check('S02 committed grant visible/replayed through a second repository with same key', async () => {
      const b = new StorageCore(other, () => transport(), adapters(other, runId, clock).hooks, clock), replay = await b.issue(f.token, input('small'));
      assert.equal(replay.status.id, issued.status.id); assert.equal(replay.capability?.key, issued.capability?.key); assert((await other.get('storageUploadGrant', issued.status.id))?.data.capability);
      assert(!JSON.stringify(await b.status(f.token, issued.status.id)).includes('token')); return { providerTTL: (replay.capability!.storageExpiresAt - (await other.get('storageUploadGrant', issued.status.id))!.data.identity.issuedAt) / 1000 };
    });
    const r = await fetch(issued.capability!.signedUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'text/csv' } }); assert.equal(r.status, 200); await r.body?.cancel();
    await check('S03 actual finalize commits one exact object/file/receipt/audit, replay unchanged', async () => {
      const ready = await core.finalize(f.token, issued.status.id), again = await core.finalize(f.token, issued.status.id); assert.deepEqual(again, ready);
      const grant = (await other.get('storageUploadGrant', issued.status.id))!; assert.equal(grant.data.result?.auditIds.length, 1);
      assert.equal((await other.get('task', f.taskId))?.data.status, 'requested'); assert.equal(promotions, 1);
      assert.deepEqual(await adapters(other, runId, clock).reader(() => transport()).snapshot(f.token, grant.data.objectId), bytes);
      return { ready: ready.state, bytes: bytes.length, auditCount: grant.data.result!.auditIds.length, promotions };
    });
    await check('PG03 two independent finalizers produce one ready result and one fixed final', async () => {
      const id = await uploaded('race'), before = promotions, b = new StorageCore(other, () => transport(), adapters(other, runId, clock).hooks, clock);
      const results = await Promise.allSettled([core.finalize(f.token, id), b.finalize(f.token, id)]);
      assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
      const loser = results.find(x => x.status === 'rejected') as PromiseRejectedResult; assert(['CONFLICT', 'PENDING'].includes(loser.reason.code));
      const ready = await b.finalize(f.token, id); assert.equal(ready.state, 'ready'); assert.equal(promotions - before, 1);
      return { fulfilled: 1, rejected: 1, loserCode: loser.reason.code, promotions: 1 };
    });
    await check('PG04 DB rollback after final creation and fresh OS process recovery reuse exact final', async () => {
      const id = await uploaded('rollback'), before = promotions; rollback = true;
      await assert.rejects(core.finalize(f.token, id)); rollback = false;
      const grant = (await other.get('storageUploadGrant', id))!; assert.equal(grant.data.state, 'recovery_required'); assert.equal(await other.get('storageObject', grant.data.objectId), null);
      const childFile = `${outputFile}.child.json`;
      execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', process.argv[1], envFile, childFile, 'recover', runId, id], { cwd: process.cwd(), stdio: 'pipe', timeout: 120_000 });
      const child = JSON.parse(readFileSync(childFile, 'utf8')); assert.notEqual(child.pid, process.pid); assert.equal(child.status, 'ready'); assert.equal(child.promotions, 0);
      assert.equal(promotions - before, 1); assert.equal((await other.get('storageUploadGrant', id))!.data.result!.record.id, child.record.id);
      return { differentPID: true, recoveryPromotions: 0, sameFinalKey: true };
    });
    await check('S04 unknown remote outcome inspects same final; no second promotion', async () => {
      const id = await uploaded('unknown'), before = promotions;
      const uncertain = new StorageCore(repo, () => transport({ promoteVerified: async i => { promotions++; await remote.promoteVerified(i); throw new StorageError('TIMEOUT', undefined, 'unknown'); } }), a.hooks, clock);
      await assert.rejects(uncertain.finalize(f.token, id), { code: 'RECOVERY_REQUIRED' });
      assert.equal((await core.finalize(f.token, id)).state, 'ready'); assert.equal(promotions - before, 1);
    });
    await check('PG05 unknown successful COMMIT preserves ready row and does not delete final', async () => {
      const id = await uploaded('commit-unknown'); let injected = false;
      const wrapper: RecordRepository = { ...repo, transaction: async operation => { const value = await repo.transaction(operation); if (!injected && (await repo.get('storageUploadGrant', id))?.data.state === 'ready') { injected = true; throw new StorageCoreError('RECOVERY_REQUIRED'); } return value; } };
      const uncertain = new StorageCore(wrapper, () => transport(), adapters(wrapper, runId, clock).hooks, clock);
      await assert.rejects(uncertain.finalize(f.token, id), { code: 'RECOVERY_REQUIRED' });
      const grant = (await other.get('storageUploadGrant', id))!; assert.equal(grant.data.state, 'ready'); assert.equal((await core.finalize(f.token, id)).result?.id, grant.data.result?.record.id);
      assert.equal((await remote.inspect(grant.data.identity.finalKey)).id, grant.data.finalObject!.id);
    });
    await check('PG06 raw SQL immutable object/grant identity and JSONB key-order semantic equivalence', async () => {
      const grant = (await other.get('storageUploadGrant', issued.status.id))!;
      await assert.rejects(sql(`UPDATE ${schema}.records SET data=data||'{"actorId":"forged"}'::jsonb WHERE kind='storageObject' AND id=$1`, [grant.data.objectId]), { code: '23514' });
      await assert.rejects(sql(`UPDATE ${schema}.records SET data=jsonb_set(data,'{identity,originalName}','"forged.csv"'::jsonb) WHERE kind='storageUploadGrant' AND id=$1`, [grant.id]), { code: '23514' });
      assert.equal((await other.get('storageUploadGrant', grant.id))!.data.identity.bodyHash, grant.data.identity.bodyHash);
      const pending = await core.issue(f.token, input('jsonb-order'));
      await sql(`UPDATE ${schema}.records SET data=data::text::jsonb WHERE kind='storageUploadGrant' AND id=$1`, [pending.status.id]);
      assert.equal((await core.issue(f.token, input('jsonb-order'))).status.id, pending.status.id);
    });
    await check('S05 metadata+hash refusal after real direct upload leaves feature absent', async () => {
      const bad = await core.issue(f.token, input('bad-bytes'));
      const response = await fetch(bad.capability!.signedUrl, { method: 'PUT', body: Buffer.from('wrong'), headers: { 'content-type': 'text/csv' } }); assert.equal(response.status, 200); await response.body?.cancel();
      await assert.rejects(core.finalize(f.token, bad.status.id), { code: 'REJECTED' }); const grant = (await other.get('storageUploadGrant', bad.status.id))!; assert.equal(grant.data.result, null); assert.equal(await other.get('storageObject', grant.data.objectId), null);
    });
    await check('S06 actual25MiB direct app grant/finalize and seven current-authorized range chunks', async () => {
      const large = Buffer.alloc(STORAGE_LIMITS.generalBytes, 97), id = await uploaded('large25mib', large); await core.finalize(f.token, id);
      const grant = (await other.get('storageUploadGrant', id))!; const read = adapters(other, runId, clock).reader(() => transport());
      assert.deepEqual(await read.snapshot(f.token, grant.data.objectId), large);
      return { bytes: large.length, boundedChunks: Math.ceil(large.length / STORAGE_LIMITS.chunkBytes), wholeSha256: digest(large) };
    });
    await check('PG07 shared parsed JSON exact decimal/hash and same-UoW consume rollback', async () => {
      const staging = new SharedImportStaging(repo, async (s, token: string) => ({ actorId: (await new (await import('@/server/auth/service')).IdentityService(repo, clock).principal(s, token)).user.id }), clock);
      const row = await staging.put(f.token, { contextId: f.contextId, stageType: 'source', sourceObjectId: null, sourceStageId: null, sourceHash: digest(bytes), payload: { code: '0009', price: '1234567890123456789.123456' } });
      await assert.rejects(repo.transaction(async s => { await staging.consume(s, f.token, row.id); throw new StorageCoreError('REJECTED'); }), { code: 'REJECTED' });
      assert.equal((await other.get('importStage', row.id))?.data.state, 'active'); assert.deepEqual(await staging.get(f.token, row.id), { code: '0009', price: '1234567890123456789.123456' });
    });
    await check('S07 exclusive cleanup claim blocks finalize and late signed upload cannot create feature', async () => {
      const id = await uploaded('cleanup'); const grant = (await other.get('storageUploadGrant', id))!;
      const future = () => new Date(grant.data.safeCleanupAfter + 1).toISOString();
      // Simulated safe wall clock on own synthetic object, not proof of 24 elapsed hours.
      let release!: () => void, entered!: () => void;
      const barrier = new Promise<void>(r => { release = r; }), observed = new Promise<void>(r => { entered = r; });
      const expired = new StorageCore(repo, () => transport({ cleanupExpiredStaging: async (...args) => { entered(); await barrier; return remote.cleanupExpiredStaging(...args); } }), adapters(repo, runId, future).hooks, future);
      const cleanup = expired.cleanup(f.token, id);
      await observed;
      try {
        await assert.rejects(core.finalize(f.token, id), { code: 'REJECTED' });
        await assert.rejects(new StorageCore(other, () => transport(), adapters(other, runId, future).hooks, future).cleanup(f.token, id), { code: 'CONFLICT' });
      } finally { release(); }
      assert.equal((await cleanup).state, 'cleaned');
      const reply = await fetch(grant.data.capability!.signedUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'text/csv' } }); const status = reply.status; await reply.body?.cancel();
      await assert.rejects(expired.finalize(f.token, id), { code: 'REJECTED' }); assert.equal((await other.get('storageUploadGrant', id))!.data.result, null);
      return { simulatedWallClock: true, lateSignedUploadStatus: status, finalized: false };
    });
    await check('S08 original/reference membership revoke denies status/replay/finalize and bounded reader', async () => {
      const grant = (await other.get('storageUploadGrant', issued.status.id))!;
      await other.transaction(async s => { const member = (await s.get('membership', f.memberId))!; await s.update('membership', member.id, member.revision, { ...member.data, status: 'suspended', suspendedAt: clock() }); });
      for (const op of [() => core.status(f.token, grant.id), () => core.issue(f.token, input('small')), () => core.finalize(f.token, grant.id), () => a.reader(() => transport()).chunk(f.token, grant.data.objectId, 0, 1)]) await assert.rejects(op(), { code: 'NOT_FOUND' });
      return { deniedOperations: 4 };
    });
  } catch { checks.push({ name: 'execution prerequisite', status: 'FAIL', code: 'PREREQUISITE_FAILED' }); save(); }
  finally {
    await check('C01 exact owned synthetic remote keys cleanup; schema/rows/bucket retained', async () => {
      if (!owned.size) return { exactOwnedKeys: 0 };
      assert([...owned].every(k => k.startsWith(`${namespace}/`)));
      const response = await fetch(`${storageConfig.projectUrl}/storage/v1/object/${storageConfig.bucket}`, { method: 'DELETE', headers: { apikey: storageConfig.secretKey, authorization: `Bearer ${storageConfig.secretKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [...owned] }), signal: AbortSignal.timeout(60_000) });
      const status = response.status; await response.body?.cancel(); assert.equal(status, 200); return { exactOwnedKeys: owned.size, remoteFinalDeletionOnlySyntheticCleanup: true, schemaRetained: true };
    });
    report.env_unchanged = envHash === digest(readFileSync(envFile)); save();
    await repo.close(); await other.close(); await pool.end();
    if (report.counts.fail) process.exitCode = 1;
  }
}
