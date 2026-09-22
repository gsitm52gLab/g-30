import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { seed } from '@/server/db/seed';
import type { RecordRepository } from '@/domain/records';
import { StorageCore } from '@/server/storage/core';
import { StorageCoreError, type StorageHooks, type StorageTransport } from '@/server/storage/contracts';
import { StorageError } from '@/server/storage/supabase';
import { AuthorizedStorageReader } from '@/server/storage/read';
import { SharedImportStaging } from '@/server/storage/staging';
import { grantStatus, uploadCapability } from '@/server/storage/projection';
import { digest } from '@/domain/storage/validate';
import { STORAGE_LIMITS, type StorageDescriptor, type UploadInput } from '@/domain/storage/types';
import { appendAudit, auditOperation } from '@/server/audit/writer';
class FakeStorage implements StorageTransport {
  objects = new Map<string, { object: StorageDescriptor; bytes: Buffer }>();
  issued = 0; promotions = 0; deleted = 0; ranges = 0;
  afterPromote: (() => Promise<void>) | null = null;
  afterRange: (() => Promise<void>) | null = null;
  unknownPromotion = false;
  beforeCleanup: (() => Promise<void>) | null = null;
  allocateStagingKey() { return `core_test/staging/${randomUUID()}`; }
  allocateFinalKey() { return `core_test/final/${randomUUID()}`; }
  put(key: string, bytes: Buffer) { this.objects.set(key, { bytes: Buffer.from(bytes), object: { key, id: randomUUID(), version: randomUUID(), bytes: bytes.length, etag: `"${createHash('md5').update(bytes).digest('hex')}"`, contentType: 'text/csv' } }); }
  async issueUploadGrant(i: { key: string; expectedBytes: number; appExpiresAt: number; now?: number }) {
    this.issued++; const now = i.now!;
    return { key: i.key, bucket: 'private', signedUrl: 'https://synthetic.supabase.co/capability', token: 'synthetic-token', method: 'PUT' as const, resumableEndpoint: 'https://synthetic.storage.supabase.co/resumable', tusChunkBytes: 6 * 1024 * 1024, appExpiresAt: i.appExpiresAt, storageExpiresAt: now + 2 * 3600_000, safeCleanupAfter: now + STORAGE_LIMITS.cleanupMs, expectedBytes: i.expectedBytes, bucketMaxBytes: STORAGE_LIMITS.generalBytes };
  }
  async inspect(key: string) { const r = this.objects.get(key); if (!r) throw new StorageError('NOT_FOUND'); return { ...r.object }; }
  async readSnapshot(key: string) { const object = await this.inspect(key), bytes = Buffer.from(this.objects.get(key)!.bytes); return { object, bytes, sha256: digest(bytes) }; }
  async promoteVerified(i: { stagingKey: string; finalKey: string; originalName: string; declaredMime: string; expectedBytes: number }) {
    this.promotions++; if (this.objects.has(i.finalKey)) throw new StorageError('CONFLICT');
    const source = await this.readSnapshot(i.stagingKey); this.put(i.finalKey, source.bytes);
    await this.afterPromote?.();
    if (this.unknownPromotion) throw new StorageError('TIMEOUT', undefined, 'unknown');
    return { ...await this.inspect(i.finalKey), sha256: source.sha256, originalName: i.originalName, mime: 'text/csv', preview: false };
  }
  async readRange(expected: StorageDescriptor, start: number, end: number) {
    this.ranges++; const current = await this.inspect(expected.key);
    if (current.version !== expected.version) throw new StorageError('INTEGRITY');
    const result = this.objects.get(expected.key)!.bytes.subarray(start, end + 1); await this.afterRange?.(); return Buffer.from(result);
  }
  async cleanupExpiredStaging(expected: StorageDescriptor, safe: number, now = Date.now()) {
    await this.beforeCleanup?.();
    if (now <= safe) throw new StorageError('NOT_EXPIRED');
    if ((await this.inspect(expected.key)).version !== expected.version) throw new StorageError('INTEGRITY');
    this.deleted++; this.objects.delete(expected.key);
  }
}
for (const mode of ['mock', 'sqlite'] as const) describe(`durable storage core ${mode}`, () => {
  let repo: RecordRepository, remote: FakeStorage, core: StorageCore<string, string>, hooks: StorageHooks<string, string>;
  let now: number, commitFailure: boolean, authCalls: number;
  const bytes = Buffer.from('synthetic,value\nHALE,1\n');
  const input = (patch: Partial<UploadInput> = {}): UploadInput => ({ contextId: 'ctx-jp-a-luna', owner: { purpose: 'task_reference', taskId: 'task-pop' }, visibility: 'public', clientItemId: 'file-1', originalName: 'data.csv', declaredMime: 'text/csv', expectedBytes: bytes.length, expectedSha256: digest(bytes), ...patch });
  const clock = () => new Date(now).toISOString();
  beforeEach(async () => {
    now = Date.parse('2026-09-22T04:00:00Z'); commitFailure = false; authCalls = 0;
    if (mode === 'mock') repo = createMockRepository(clock);
    else { const db = openDatabase(':memory:', true); migrate(db); repo = createSqliteRepository(db, clock); }
    await seed(repo); remote = new FakeStorage();
    hooks = {
      async authorize(s, actorId, binding) {
        authCalls++; const user = await s.get('user', actorId);
        if (!user || user.data.status === 'suspended') throw new StorageCoreError('NOT_FOUND');
        if (binding.owner.purpose === 'task_reference') {
          const task = await s.get('task', binding.owner.taskId);
          if (task?.contextId !== binding.contextId || task.data.ownerId !== actorId) throw new StorageCoreError('NOT_FOUND');
        }
        return { actorId };
      },
      async validate(_i, content) { return content.toString(); },
      async commit(s, { grant, object, descriptor }) {
        const id = randomUUID(), receiptId = randomUUID();
        return auditOperation(s, receiptId, async () => {
          await s.create('fileVersion', { id, contextId: grant.contextId, data: { backend: { kind: 'supabase', objectId: object.id }, taskId: 'task-pop', owner: { kind: 'task', taskId: 'task-pop' }, storageKey: object.id, originalName: descriptor.originalName, mime: descriptor.mime, bytes: descriptor.bytes, sha256: descriptor.sha256, preview: descriptor.preview, visibility: 'public', uploaderId: grant.data.identity.actorId } });
          await s.create('commandReceipt', { id: receiptId, contextId: grant.contextId, data: { key: receiptId, actorId: grant.data.identity.actorId, command: 'storage-fixture', bodyHash: grant.data.identity.bodyHash, result: { ids: [id] } } });
          const user = (await s.get('user', grant.data.identity.actorId))!;
          const audit = await appendAudit(s, { user }, clock, grant.contextId, 'task.file_uploaded', 'task-pop', {}, { fileVersionIds: [id] });
          if (commitFailure) throw new Error('SYNTHETIC_COMMIT_ROLLBACK');
          return { record: { kind: 'fileVersion', id }, receiptId, auditIds: [audit.id] };
        });
      },
    };
    core = new StorageCore(repo, () => remote, hooks, clock);
  });
  afterEach(async () => { await repo.close(); });
  async function uploaded() { const issued = await core.issue('user-gsg', input()); remote.put(issued.capability!.key, bytes); return issued.status.id; }
  async function suspend() { await repo.transaction(async s => { const u = (await s.get('user', 'user-gsg'))!; await s.update('user', u.id, u.revision, { ...u.data, status: 'suspended' }); }); }
  it('deduplicates canonical metadata, preserves result and commits feature/receipt/exact audit atomically', async () => {
    const id = await uploaded(), ready = await core.finalize('user-gsg', id);
    const again = await core.issue('user-gsg', { ...input(), owner: { taskId: 'task-pop', purpose: 'task_reference' } });
    expect(again.status.result).toEqual(ready.result); expect(again.capability).toBeNull();
    expect((await core.finalize('user-gsg', id)).result).toEqual(ready.result);
    expect(remote.issued).toBe(1); expect(remote.promotions).toBe(1); expect((await repo.list('storageObject')).length).toBe(1);
    expect((await repo.list('fileVersion')).length).toBe(1);
    const status = JSON.stringify(await core.status('user-gsg', id)); expect(status).not.toContain('token'); expect(status).not.toContain('core_test/');
    expect((await repo.get('task', 'task-pop'))?.data.status).toBe('requested');
    await expect(core.issue('user-gsg', input({ originalName: 'different.csv' }))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects bad metadata and 11-file batches before remote capability issuance', async () => {
    for (const patch of [{ expectedBytes: 0 }, { expectedBytes: STORAGE_LIMITS.generalBytes + 1 }, { originalName: '../private.csv' }, { expectedSha256: 'not-hash' }]) await expect(core.issue('user-gsg', input(patch))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    await expect(core.issueBatch('user-gsg', Array.from({ length: 11 }, (_, i) => input({ clientItemId: String(i) })))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(remote.issued).toBe(0);
  });
  it('denies wrong bytes and leaves upload distinct from submission or publication', async () => {
    const issued = await core.issue('user-gsg', input()); remote.put(issued.capability!.key, Buffer.from('different'));
    await expect(core.finalize('user-gsg', issued.status.id)).rejects.toMatchObject({ code: 'REJECTED' });
    expect((await core.status('user-gsg', issued.status.id)).state).toBe('rejected'); expect(remote.promotions).toBe(0); expect(await repo.list('storageObject')).toEqual([]);
  });
  it('rejects expired first finalize and supports exclusive safe-deadline staging cleanup', async () => {
    const id = await uploaded(); now += STORAGE_LIMITS.grantMs + 1;
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'EXPIRED' });
    await expect(core.cleanup('user-gsg', id)).rejects.toMatchObject({ code: 'CONFLICT' });
    now += STORAGE_LIMITS.cleanupMs;
    expect((await core.cleanup('user-gsg', id)).state).toBe('cleaned'); expect(remote.deleted).toBe(1);
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'REJECTED' });
  });
  it('recovers exact final bytes after DB rollback on a new service instance, with no duplicate promotion', async () => {
    const id = await uploaded(); commitFailure = true;
    await expect(core.finalize('user-gsg', id)).rejects.toThrow('SYNTHETIC_COMMIT_ROLLBACK');
    expect(await repo.list('fileVersion')).toEqual([]); expect(await repo.list('storageObject')).toEqual([]); expect(remote.deleted).toBe(0);
    commitFailure = false; const other = new StorageCore(repo, () => remote, hooks, clock);
    expect((await other.finalize('user-gsg', id)).state).toBe('ready'); expect(remote.promotions).toBe(1);
  });
  it('retains unknown promotion outcome then inspects only the same final key', async () => {
    const id = await uploaded(); remote.unknownPromotion = true;
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    remote.unknownPromotion = false;
    expect((await new StorageCore(repo, () => remote, hooks, clock).finalize('user-gsg', id)).state).toBe('ready'); expect(remote.promotions).toBe(1);
  });
  it('rechecks authority after remote I/O and before replay/status, without deleting possible final bytes', async () => {
    const id = await uploaded(); remote.afterPromote = suspend;
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(core.status('user-gsg', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(core.issue('user-gsg', input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repo.list('fileVersion')).toEqual([]); expect(remote.deleted).toBe(0);
  });
  it('checks original/reference resolver before and after each bounded read; discards late revoked bytes', async () => {
    const id = await uploaded(); await core.finalize('user-gsg', id); const object = (await repo.list('storageObject'))[0];
    const reader = new AuthorizedStorageReader(repo, () => remote, async (s, credentials: string, row) => { await hooks.authorize(s, credentials, row.data.binding, 'read'); return { authorizationStamp: 'exact-source-and-reference-v1' }; });
    const before = authCalls; expect(await reader.snapshot('user-gsg', object.id)).toEqual(bytes); expect(authCalls - before).toBeGreaterThanOrEqual(4);
    remote.afterRange = suspend; await expect(reader.chunk('user-gsg', object.id, 0, bytes.length - 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('lets only one held finalize commit and denies simultaneous cleanup', async () => {
    const id = await uploaded(); let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(r => { release = r; }), observed = new Promise<void>(r => { entered = r; });
    remote.afterPromote = async () => { entered(); await barrier; };
    const first = core.finalize('user-gsg', id); await observed;
    const other = new StorageCore(repo, () => remote, hooks, clock);
    await expect(other.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'PENDING' });
    await expect(other.cleanup('user-gsg', id)).rejects.toMatchObject({ code: 'CONFLICT' });
    release(); expect((await first).state).toBe('ready'); expect(remote.promotions).toBe(1);
  });
  it('cleanup claim blocks a late finalize and a second cleanup while exact deletion is held', async () => {
    const id = await uploaded(); now += STORAGE_LIMITS.cleanupMs + 1;
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(r => { release = r; }), observed = new Promise<void>(r => { entered = r; });
    remote.beforeCleanup = async () => { entered(); await barrier; };
    const cleanup = core.cleanup('user-gsg', id); await observed;
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'REJECTED' });
    await expect(core.cleanup('user-gsg', id)).rejects.toMatchObject({ code: 'CONFLICT' });
    release(); expect((await cleanup).state).toBe('cleaned'); expect(remote.deleted).toBe(1);
  });
  it('expired finalize lease recovers same key on another service; stale writer cannot duplicate it', async () => {
    const id = await uploaded(); let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(r => { release = r; }), observed = new Promise<void>(r => { entered = r; });
    remote.afterPromote = async () => { entered(); await barrier; };
    const first = core.finalize('user-gsg', id).then(() => 'unexpected', (e: Error & { code: string }) => e.code); await observed;
    now += STORAGE_LIMITS.leaseMs + 1;
    expect((await new StorageCore(repo, () => remote, hooks, clock).finalize('user-gsg', id)).state).toBe('ready');
    release(); expect(await first).toBe('CONFLICT'); expect(remote.promotions).toBe(1); expect((await repo.list('fileVersion')).length).toBe(1);
  });
  it('unknown final absence remains recovery_required without re-upload or a new final key', async () => {
    const id = await uploaded(); remote.unknownPromotion = true;
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    const grant = (await repo.get('storageUploadGrant', id))!; remote.objects.delete(grant.data.identity.finalKey);
    await expect(new StorageCore(repo, () => remote, hooks, clock).finalize('user-gsg', id)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(remote.promotions).toBe(1); expect((await core.status('user-gsg', id)).state).toBe('recovery_required');
  });
  it('rejects changed staging after verification and never commits mismatched final bytes', async () => {
    const id = await uploaded(), original = remote.promoteVerified.bind(remote);
    remote.promoteVerified = async i => { remote.put(i.stagingKey, Buffer.from('changed,value\nno,2\n')); return original(i); };
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(await repo.list('fileVersion')).toEqual([]); expect(remote.deleted).toBe(0);
  });
  it('ready replay still checks current authorization and has no lazy transport dependency', async () => {
    const id = await uploaded(); await core.finalize('user-gsg', id);
    const noConfig = new StorageCore(repo, () => { throw Error('storage config must stay lazy'); }, hooks, clock);
    expect((await noConfig.status('user-gsg', id)).state).toBe('ready');
    expect((await noConfig.finalize('user-gsg', id)).state).toBe('ready');
    await suspend(); await expect(noConfig.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('validates persisted known scalars while suppressing unknown nested extensions in reply', async () => {
    const id = await uploaded(), raw = (await repo.get('storageUploadGrant', id))!;
    const extra = { ...raw, data: { ...raw.data, hiddenExtension: { PRIVATE_CANARY: true } } };
    expect(JSON.stringify(grantStatus(extra))).not.toContain('PRIVATE_CANARY');
    expect(JSON.stringify(uploadCapability({ ...raw.data.capability!, hidden: { PRIVATE_CANARY: true } } as NonNullable<typeof raw.data.capability>))).not.toContain('PRIVATE_CANARY');
    const corrupted = structuredClone(raw); Object.assign(corrupted.data, { state: 'ready', claim: null, result: { record: { PRIVATE_CANARY: true } } });
    expect(() => grantStatus(corrupted)).toThrow();
    expect((await repo.get('storageUploadGrant', id))!.data).toEqual(raw.data);
  });
  it('keeps descriptor and grant identity immutable and rolls back a bad same-UoW callback', async () => {
    const id = await uploaded(), original = hooks.commit;
    hooks.commit = async (...args) => { const r = await original(...args); return { ...r, auditIds: [] }; };
    await expect(core.finalize('user-gsg', id)).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    expect(await repo.list('fileVersion')).toEqual([]); expect(await repo.list('storageObject')).toEqual([]);
    hooks.commit = original; await core.finalize('user-gsg', id);
    const object = (await repo.list('storageObject'))[0], grant = (await repo.get('storageUploadGrant', id))!;
    await expect(repo.transaction(s => s.update('storageObject', object.id, object.revision, { ...object.data }))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    await expect(repo.transaction(s => s.update('storageUploadGrant', id, grant.revision, { ...grant.data, identity: { ...grant.data.identity, originalName: 'other.csv' } }))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
  });
  it('enforces AI batch count/aggregate, metadata MIME and exact general byte boundary before issue', async () => {
    const image = (n: number) => input({ clientItemId: String(n), owner: { purpose: 'ai_asset', inputKind: 'image' }, originalName: 'image.png', declaredMime: 'image/png' });
    await expect(core.issueBatch('user-gsg', Array.from({ length: 5 }, (_, i) => image(i)))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(core.issueBatch('user-gsg', [image(1), { ...image(2), expectedBytes: STORAGE_LIMITS.specificBytes }])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const patch of [{ originalName: 'unsupported.exe' }, { declaredMime: 'image/png' }]) await expect(core.issue('user-gsg', input(patch))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    expect(remote.issued).toBe(0);
    expect((await core.issue('user-gsg', input({ expectedBytes: STORAGE_LIMITS.generalBytes }))).capability?.expectedBytes).toBe(STORAGE_LIMITS.generalBytes);
  });
  it('retains successful batch capabilities and retries only the failed item with its stable identity', async () => {
    const issue = remote.issueUploadGrant.bind(remote); let firstFailure = true;
    remote.issueUploadGrant = async i => { if (firstFailure && remote.issued === 1) { firstFailure = false; throw new StorageError('TIMEOUT', undefined, 'unknown'); } return issue(i); };
    const results = await core.issueBatch('user-gsg', [input(), input({ clientItemId: 'file-2' }), input({ clientItemId: 'file-3' })]);
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
    expect(results[1]).toEqual({ clientItemId: 'file-2', ok: false, error: 'RETRY_REQUIRED' });
    const failed = (await repo.list('storageUploadGrant')).find(g => g.data.identity.clientItemId === 'file-2')!;
    now += STORAGE_LIMITS.leaseMs + 1;
    const retry = await core.issue('user-gsg', input({ clientItemId: 'file-2' }));
    expect(retry.status.id).toBe(failed.id); expect(retry.capability?.key).toBe(failed.data.identity.stagingKey);
    expect((await repo.list('storageUploadGrant')).length).toBe(3); expect(remote.issued).toBe(3);
  });
  it('caps active private stages at 50 and preserves payload when a 51st insert is rejected', async () => {
    const staging = new SharedImportStaging(repo, async (_s, actorId: string) => ({ actorId }), clock);
    const input = { contextId: 'ctx-jp-a-luna', stageType: 'source' as const, sourceObjectId: null, sourceStageId: null, sourceHash: digest(bytes), payload: { code: '001' } };
    for (let n = 0; n < 50; n++) await staging.put('user-gsg', input);
    await expect(staging.put('user-gsg', input)).rejects.toMatchObject({ code: 'STAGING_LIMIT' });
    expect((await repo.list('importStage')).length).toBe(50);
    await expect(staging.get('user-brand', (await repo.list('importStage'))[0].id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('stores import payload separately with actor/expiry/hash and preserves atomic consume rollback', async () => {
    const staging = new SharedImportStaging(repo, async (s, credentials: string, contextId) => hooks.authorize(s, credentials, { contextId, owner: { purpose: 'import_source' }, visibility: 'internal' }, 'read'), clock);
    const row = await staging.put('user-gsg', { contextId: 'ctx-jp-a-luna', stageType: 'source', sourceObjectId: null, sourceStageId: null, sourceHash: digest(bytes), payload: { rows: [{ code: '00003', price: '12345678901234567890.123456' }] } });
    expect(await staging.get('user-gsg', row.id)).toEqual({ rows: [{ code: '00003', price: '12345678901234567890.123456' }] });
    await expect(repo.transaction(async s => { await staging.consume(s, 'user-gsg', row.id); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await repo.get('importStage', row.id))?.data.state).toBe('active');
    now += STORAGE_LIMITS.sourceMs + 1; await expect(staging.get('user-gsg', row.id)).rejects.toMatchObject({ code: 'EXPIRED' });
    await repo.transaction(s => staging.expire(s, 'user-gsg', row.id)); expect((await repo.get('importStage', row.id))?.data.payload).toBeNull();
  });
});
