import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Clock, RecordRepository, StoredRecord, UnitOfWork } from '@/domain/records';
import { systemClock, StoreError } from '@/domain/records';
import { storageFile, canonical, digest, descriptor, grantShape, uploadInput, resultShape } from '@/domain/storage/validate';
import { STORAGE_LIMITS, type GrantStatus, type StorageGrantData, type UploadCapability, type UploadInput, type VerifiedDescriptor, type BatchGrantResult } from '@/domain/storage/types';
import { StorageError } from './supabase';
import { StorageCoreError, type StorageHooks, type StorageTransport, type StorageAction } from './contracts';
import { grantStatus, uploadCapability } from './projection';
type Grant = StoredRecord<'storageUploadGrant'>;
export class StorageCore<Credentials, Validated> {
  constructor(readonly repository: RecordRepository, private transport: () => StorageTransport,
    private hooks: StorageHooks<Credentials, Validated>, private clock: Clock = systemClock) {}
  private now() { const n = Date.parse(this.clock()); if (!Number.isSafeInteger(n) || n <= 0) throw new StoreError('INVALID_RECORD'); return n; }
  private async authorized(s: UnitOfWork, credentials: Credentials, id: string, action: StorageAction): Promise<Grant> {
    const row = await s.get('storageUploadGrant', id);
    if (!row) throw new StorageCoreError('NOT_FOUND');
    grantShape(row.data);
    const p = await this.hooks.authorize(s, credentials, row.data.identity, action);
    if (p.actorId !== row.data.identity.actorId) throw new StorageCoreError('NOT_FOUND');
    return row;
  }
  private async claimed(s: UnitOfWork, credentials: Credentials, id: string, claim: string): Promise<Grant> {
    const row = await this.authorized(s, credentials, id, 'finalize');
    if (row.data.state !== 'finalizing' || row.data.claim?.id !== claim || row.data.claim.until <= this.now()) throw new StorageCoreError('CONFLICT');
    return row;
  }
  async status(credentials: Credentials, id: string): Promise<GrantStatus> {
    return this.repository.transaction(async s => grantStatus(await this.authorized(s, credentials, id, 'status')));
  }
  async issueBatch(credentials: Credentials, inputs: UploadInput[]): Promise<BatchGrantResult[]> {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > STORAGE_LIMITS.batchFiles) throw new StorageCoreError('INVALID_INPUT');
    const normalized = inputs.map(uploadInput);
    if (new Set(normalized.map(i => i.clientItemId)).size !== normalized.length) throw new StorageCoreError('INVALID_INPUT');
    const images = normalized.filter(i => i.owner.purpose === 'ai_asset' && i.owner.inputKind === 'image');
    if (images.length > STORAGE_LIMITS.aiImages || images.reduce((n, i) => n + i.expectedBytes, 0) > STORAGE_LIMITS.specificBytes) throw new StorageCoreError('INVALID_INPUT');
    const results: BatchGrantResult[] = [];
    for (const input of normalized) {
      try { results.push({ clientItemId: input.clientItemId, ok: true, ...await this.issue(credentials, input) }); }
      catch (error) {
        const code = error instanceof StorageCoreError ? error.code : error instanceof StoreError && error.code === 'CONFLICT' ? 'CONFLICT' : null;
        const safe = code && ['NOT_FOUND', 'CONFLICT', 'EXPIRED', 'PENDING', 'REJECTED'].includes(code) ? code as 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'PENDING' | 'REJECTED' : 'RETRY_REQUIRED';
        results.push({ clientItemId: input.clientItemId, ok: false, error: safe });
      }
    }
    return results;
  }
  async issue(credentials: Credentials, raw: UploadInput): Promise<{ status: GrantStatus; capability: UploadCapability | null }> {
    const input = uploadInput(raw), now = this.now(), claim = randomUUID();
    const prepared = await this.repository.transaction(async s => {
      const p = await this.hooks.authorize(s, credentials, input, 'issue');
      const dedupeKey = digest(canonical({ actorId: p.actorId, contextId: input.contextId, owner: input.owner, clientItemId: input.clientItemId }));
      const id = `storage-grant-${dedupeKey}`, existing = await s.get('storageUploadGrant', id), bodyHash = digest(canonical(input));
      if (existing) {
        const row = await this.authorized(s, credentials, id, 'issue');
        if (row.data.identity.bodyHash !== bodyHash) throw new StorageCoreError('CONFLICT');
        if (row.data.state === 'ready') return { row, sign: false };
        if (this.now() >= row.data.appExpiresAt) throw new StorageCoreError('EXPIRED');
        if (row.data.state === 'issued') return { row, sign: false };
        if (row.data.state !== 'issuing' || row.data.claim && row.data.claim.until > this.now()) throw new StorageCoreError('PENDING');
        return { row: await s.update('storageUploadGrant', id, row.revision, { ...row.data, claim: { id: claim, until: now + STORAGE_LIMITS.leaseMs }, safeCleanupAfter: Math.max(row.data.safeCleanupAfter, now + STORAGE_LIMITS.cleanupMs) }), sign: true };
      }
      // Configuration and transport construction stay lazy: auth/SQL imports require no Storage env.
      const remote = this.transport();
      const data: StorageGrantData = {
        identity: { ...input, actorId: p.actorId, dedupeKey, bodyHash, stagingKey: remote.allocateStagingKey(), finalKey: remote.allocateFinalKey(), issuedAt: now },
        state: 'issuing', claim: { id: claim, until: now + STORAGE_LIMITS.leaseMs }, appExpiresAt: now + STORAGE_LIMITS.grantMs,
        storageExpiresAt: null, safeCleanupAfter: now + STORAGE_LIMITS.cleanupMs, capability: null, promotionStarted: false,
        verifiedStaging: null, finalObject: null, objectId: randomUUID(), result: null, failure: null,
      };
      return { row: await s.create('storageUploadGrant', { id, contextId: input.contextId, data }), sign: true };
    });
    if (!prepared.sign) return { status: grantStatus(prepared.row), capability: prepared.row.data.state === 'issued' && prepared.row.data.capability ? uploadCapability(prepared.row.data.capability) : null };
    // Remote capability issuance is outside the UoW. A failed/unknown issue retains the pending identity.
    const capability = await this.transport().issueUploadGrant({ key: prepared.row.data.identity.stagingKey, expectedBytes: input.expectedBytes, appExpiresAt: prepared.row.data.appExpiresAt, now });
    return this.repository.transaction(async s => {
      const row = await this.authorized(s, credentials, prepared.row.id, 'issue');
      if (row.data.state !== 'issuing' || row.data.claim?.id !== claim || row.data.claim.until <= this.now()) throw new StorageCoreError('CONFLICT');
      if (this.now() >= row.data.appExpiresAt) throw new StorageCoreError('EXPIRED');
      const next = await s.update('storageUploadGrant', row.id, row.revision, { ...row.data, state: 'issued', claim: null, capability: uploadCapability(capability), storageExpiresAt: capability.storageExpiresAt, safeCleanupAfter: Math.max(row.data.safeCleanupAfter, capability.safeCleanupAfter), failure: null });
      return { status: grantStatus(next), capability: uploadCapability(capability) };
    });
  }
  private async failed(id: string, claim: string, rejected: boolean): Promise<void> {
    // Recovery bookkeeping is not a feature commit. Never overwrite a possibly committed ready row.
    await this.repository.transaction(async s => {
      const row = await s.get('storageUploadGrant', id);
      if (row?.data.state === 'finalizing' && row.data.claim?.id === claim)
        await s.update('storageUploadGrant', id, row.revision, { ...row.data, state: rejected ? 'rejected' : 'recovery_required', claim: null, failure: rejected ? 'REJECTED' : 'RECOVERY_REQUIRED' });
    });
  }
  async finalize(credentials: Credentials, id: string): Promise<GrantStatus> {
    const claim = randomUUID();
    let row = await this.repository.transaction(async s => {
      const row = await this.authorized(s, credentials, id, 'finalize');
      if (row.data.state === 'ready') return row;
      if (['cleanup_claimed', 'cleaned', 'rejected', 'issuing'].includes(row.data.state)) throw new StorageCoreError('REJECTED');
      if (row.data.state === 'finalizing' && row.data.claim && row.data.claim.until > this.now()) throw new StorageCoreError('PENDING');
      if (!row.data.verifiedStaging && this.now() >= row.data.appExpiresAt) throw new StorageCoreError('EXPIRED');
      return s.update('storageUploadGrant', id, row.revision, { ...row.data, state: 'finalizing', claim: { id: claim, until: this.now() + STORAGE_LIMITS.leaseMs }, failure: null });
    });
    if (row.data.state === 'ready') return grantStatus(row);
    const remote = this.transport();
    try {
      let final: VerifiedDescriptor, validated: Validated;
      if (row.data.promotionStarted) {
        // Unknown prior writes are inspected at the SAME key only. Absence is not permission to retry a mutation.
        const snapshot = await remote.readSnapshot(row.data.identity.finalKey);
        if (!row.data.verifiedStaging || snapshot.sha256 !== row.data.verifiedStaging.sha256 || snapshot.bytes.length !== row.data.verifiedStaging.bytes) throw new StorageCoreError('RECOVERY_REQUIRED');
        final = descriptor({ ...snapshot.object, ...storageFile(row.data.identity, snapshot.bytes), originalName: row.data.identity.originalName, sha256: snapshot.sha256 }, 'final');
        validated = await this.hooks.validate(row.data.identity, snapshot.bytes);
      } else {
        const snapshot = await remote.readSnapshot(row.data.identity.stagingKey), input = row.data.identity;
        if (snapshot.sha256 !== input.expectedSha256 || snapshot.bytes.length !== input.expectedBytes) throw new StorageCoreError('REJECTED');
        const format = storageFile(input, snapshot.bytes);
        validated = await this.hooks.validate(input, snapshot.bytes);
        const verified = descriptor({ ...snapshot.object, sha256: snapshot.sha256, originalName: input.originalName, mime: format.mime, preview: format.preview }, 'staging');
        row = await this.repository.transaction(async s => {
          const current = await this.claimed(s, credentials, id, claim);
          return s.update('storageUploadGrant', id, current.revision, { ...current.data, verifiedStaging: verified });
        });
        row = await this.repository.transaction(async s => {
          const current = await this.claimed(s, credentials, id, claim);
          return s.update('storageUploadGrant', id, current.revision, { ...current.data, promotionStarted: true });
        });
        final = descriptor(await remote.promoteVerified({ stagingKey: input.stagingKey, finalKey: input.finalKey, originalName: input.originalName, declaredMime: input.declaredMime, expectedBytes: input.expectedBytes, ...(input.owner.purpose === 'ai_asset' && input.owner.inputKind === 'image' ? { aiAssetImage: true } : {}) }), 'final');
        if (final.sha256 !== verified.sha256 || final.bytes !== verified.bytes) throw new StorageCoreError('RECOVERY_REQUIRED');
      }
      return await this.repository.transaction(async s => {
        const current = await this.claimed(s, credentials, id, claim);
        if (!current.data.verifiedStaging || final.key !== current.data.identity.finalKey || final.sha256 !== current.data.verifiedStaging.sha256 || final.bytes !== current.data.verifiedStaging.bytes) throw new StorageCoreError('RECOVERY_REQUIRED');
        const object = await s.create('storageObject', { id: current.data.objectId, contextId: current.contextId, data: { grantId: id, actorId: current.data.identity.actorId, binding: { contextId: current.contextId!, owner: current.data.identity.owner, visibility: current.data.identity.visibility }, descriptor: final } });
        const result = await this.hooks.commit(s, { grant: current, object, descriptor: final, validated });
        resultShape(result);
        const record = await s.get(result.record.kind, result.record.id);
        if (!record || record.contextId !== current.contextId) throw new StoreError('INVALID_RECORD');
        if (record.kind === 'importStage') {
          const d = record.data as import('@/domain/storage/types').ImportStageData;
          if (d.sourceObjectId !== object.id || d.sourceHash !== final.sha256) throw new StoreError('INVALID_RECORD');
        } else {
          const d = record.data as import('@/domain/tasks/types').FileVersionData;
          if (d.backend?.kind !== 'supabase' || d.backend.objectId !== object.id || d.sha256 !== final.sha256 || d.bytes !== final.bytes) throw new StoreError('INVALID_RECORD');
        }
        for (const auditId of result.auditIds) {
          const audit = await s.get('audit', auditId);
          if (audit?.data.detail?.receiptId !== result.receiptId || !audit.data.detail.references.some(ref => ref.kind === record.kind && ref.id === record.id)) throw new StoreError('INVALID_RECORD');
        }
        // Re-evaluate current authority after the feature callback, still inside the same atomic transaction.
        await this.authorized(s, credentials, id, 'finalize');
        const ready = await s.update('storageUploadGrant', id, current.revision, { ...current.data, state: 'ready', claim: null, capability: null, finalObject: final, result, failure: null });
        return grantStatus(ready);
      });
    } catch (error) {
      const rejected = error instanceof StorageCoreError && error.code === 'REJECTED';
      try { await this.failed(id, claim, rejected); } catch { /* DB outage: persisted claim/final key still permit later recovery. */ }
      // Never delete final bytes after a failed/ambiguous DB commit.
      if (error instanceof StorageError && (error.outcome === 'unknown' || row.data.promotionStarted && error.code === 'NOT_FOUND')) throw new StorageCoreError('RECOVERY_REQUIRED');
      throw error;
    }
  }
  async cleanup(credentials: Credentials, id: string): Promise<GrantStatus> {
    const claim = randomUUID();
    const row = await this.repository.transaction(async s => {
      const current = await this.authorized(s, credentials, id, 'cleanup');
      if (current.data.state === 'cleaned') return current;
      if (this.now() <= current.data.safeCleanupAfter || ['ready', 'finalizing'].includes(current.data.state) || current.data.state === 'cleanup_claimed' && current.data.claim && current.data.claim.until > this.now()) throw new StorageCoreError('CONFLICT');
      return s.update('storageUploadGrant', id, current.revision, { ...current.data, state: 'cleanup_claimed', claim: { id: claim, until: this.now() + STORAGE_LIMITS.leaseMs }, capability: null });
    });
    if (row.data.state === 'cleaned') return grantStatus(row);
    const remote = this.transport();
    try {
      const expected = await remote.inspect(row.data.identity.stagingKey);
      await this.repository.transaction(async s => {
        const current = await this.authorized(s, credentials, id, 'cleanup');
        if (current.data.state !== 'cleanup_claimed' || current.data.claim?.id !== claim || current.data.claim.until <= this.now()) throw new StorageCoreError('CONFLICT');
      });
      await remote.cleanupExpiredStaging(expected, row.data.safeCleanupAfter, this.now());
    } catch (error) { if (!(error instanceof StorageError) || error.code !== 'NOT_FOUND') throw error; }
    return this.repository.transaction(async s => {
      const current = await this.authorized(s, credentials, id, 'cleanup');
      if (current.data.state !== 'cleanup_claimed' || current.data.claim?.id !== claim || current.data.claim.until <= this.now()) throw new StorageCoreError('CONFLICT');
      return grantStatus(await s.update('storageUploadGrant', id, current.revision, { ...current.data, state: 'cleaned', claim: null }));
    });
  }
}
