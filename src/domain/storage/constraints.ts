import { StoreError, type RecordKind, type RecordInput, type StoredRecord, type SyncUnitOfWork } from '../records';
import { canonical, digest, descriptor, grantShape, stageShape, exportShape } from './validate';
import { STORAGE_LIMITS, type StorageGrantData, type StorageObjectData, type ImportStageData, type StorageBinding, type GrantState } from './types';
export type StorageRelationReader = Pick<SyncUnitOfWork, 'get' | 'list'>;
const kinds: RecordKind[] = ['storageUploadGrant', 'storageObject', 'importStage', 'importExport'];
const transitions: Record<GrantState, GrantState[]> = {
  issuing: ['issuing', 'issued', 'rejected', 'recovery_required', 'cleanup_claimed'],
  issued: ['finalizing', 'rejected', 'cleanup_claimed'],
  finalizing: ['finalizing', 'ready', 'rejected', 'recovery_required'],
  recovery_required: ['finalizing', 'recovery_required', 'rejected', 'cleanup_claimed'],
  rejected: ['cleanup_claimed'], cleanup_claimed: ['cleanup_claimed', 'cleaned'], ready: [], cleaned: [],
};
export function storageDependencies(kind: RecordKind, input: RecordInput<RecordKind>): { kind: RecordKind; id: string }[] {
  if (!kinds.includes(kind)) return [];
  const grant = input.data as StorageGrantData, object = input.data as StorageObjectData, stage = input.data as ImportStageData;
  if (kind === 'storageUploadGrant') grantShape(grant);
  if (kind === 'importStage') stageShape(stage);
  if (kind === 'importExport') exportShape(input.data as import('./types').ImportExportData);
  const result: { kind: RecordKind; id: string }[] = [{ kind, id: input.id }, { kind: 'context', id: input.contextId ?? '' }];
  result.push({ kind: 'user', id: kind === 'storageUploadGrant' ? grant.identity.actorId : kind === 'storageObject' ? object.actorId : stage.actorId });
  const binding: StorageBinding | undefined = kind === 'storageUploadGrant' ? grant.identity : kind === 'storageObject' ? object.binding : undefined;
  const o = binding?.owner;
  if (o?.purpose === 'task_reference' || o?.purpose === 'submission') result.push({ kind: 'task', id: o.taskId });
  if (o?.purpose === 'submission') result.push({ kind: 'requestVersion', id: o.requestId });
  if (o?.purpose === 'product') result.push({ kind: 'contextProduct', id: o.contextProductId }, { kind: 'product', id: o.productId });
  if (o?.purpose === 'notice') result.push({ kind: 'notice', id: o.noticeId });
  if (o?.purpose === 'inquiry') result.push({ kind: 'conversation', id: o.conversationId });
  if (kind === 'storageObject') result.push({ kind: 'storageUploadGrant', id: object.grantId });
  if (kind === 'importStage') {
    if (stage.sourceObjectId) result.push({ kind: 'storageObject', id: stage.sourceObjectId });
    if (stage.sourceStageId) result.push({ kind: 'importStage', id: stage.sourceStageId });
  }
  if (kind === 'storageUploadGrant' && grant.result) result.push({ kind: 'storageObject', id: grant.objectId }, grant.result.record, { kind: 'commandReceipt', id: grant.result.receiptId }, ...grant.result.auditIds.map(id => ({ kind: 'audit' as const, id })));
  return result;
}
export function storageRelations(s: StorageRelationReader, kind: RecordKind, input: RecordInput<RecordKind>) {
  if (!kinds.includes(kind)) return;
  const bad = () => { throw new StoreError('INVALID_RECORD'); };
  if (!input.contextId || !s.get('context', input.contextId)) bad();
  const old = s.get(kind, input.id);
  if (kind === 'importExport') {
    const d = input.data as import('./types').ImportExportData; exportShape(d);
    if (old || !s.get('user', d.actorId)) bad();
    const keys = new Set(d.parts.map(p => p.descriptor.key));
    if (s.list('importExport').some(row => row.data.parts.some(p => keys.has(p.descriptor.key)))) bad();
    return;
  }
  if (kind === 'storageUploadGrant') {
    const d = input.data as StorageGrantData; grantShape(d);
    const i = d.identity;
    if (i.contextId !== input.contextId || !s.get('user', i.actorId) || i.dedupeKey !== digest(canonical({ actorId: i.actorId, contextId: i.contextId, owner: i.owner, clientItemId: i.clientItemId })) || input.id !== `storage-grant-${i.dedupeKey}`) bad();
    const o = i.owner;
    if ((o.purpose === 'task_reference' || o.purpose === 'submission') && s.get('task', o.taskId)?.contextId !== input.contextId) bad();
    if (o.purpose === 'submission' && s.get('requestVersion', o.requestId)?.data.taskId !== o.taskId) bad();
    if (o.purpose === 'product' && (s.get('contextProduct', o.contextProductId)?.contextId !== input.contextId || s.get('contextProduct', o.contextProductId)?.data.productId !== o.productId || !s.get('product', o.productId))) bad();
    if (o.purpose === 'notice' && s.get('notice', o.noticeId)?.contextId !== input.contextId) bad();
    if (o.purpose === 'inquiry' && s.get('conversation', o.conversationId)?.contextId !== input.contextId) bad();
    if (old) {
      const before = old.data as StorageGrantData;
      if (canonical(before.identity) !== canonical(i) || before.objectId !== d.objectId || before.appExpiresAt !== d.appExpiresAt || d.safeCleanupAfter < before.safeCleanupAfter || !transitions[before.state]?.includes(d.state)) bad();
      if (before.promotionStarted && !d.promotionStarted) bad();
      if (before.verifiedStaging && canonical(before.verifiedStaging) !== canonical(d.verifiedStaging)) bad();
      if (before.finalObject && canonical(before.finalObject) !== canonical(d.finalObject)) bad();
    } else if (d.state !== 'issuing' || d.verifiedStaging || d.finalObject || d.result) bad();
    if (d.state === 'ready') {
      if (s.get('storageObject', d.objectId)?.data.grantId !== input.id || s.get(d.result!.record.kind, d.result!.record.id)?.contextId !== input.contextId) bad();
      const receipt = s.get('commandReceipt', d.result!.receiptId);
      if (receipt?.data.actorId !== i.actorId || !receipt.data.result.ids.includes(d.result!.record.id)) bad();
      for (const id of d.result!.auditIds) if (s.get('audit', id)?.data.actorId !== i.actorId || s.get('audit', id)?.contextId !== input.contextId) bad();
    }
  } else if (kind === 'storageObject') {
    const d = input.data as StorageObjectData, grant = s.get('storageUploadGrant', d.grantId);
    const v = descriptor(d.descriptor, 'final');
    if (old || !grant || grant.contextId !== input.contextId || grant.data.objectId !== input.id || grant.data.identity.actorId !== d.actorId || canonical(d.binding) !== canonical({ contextId: grant.contextId, owner: grant.data.identity.owner, visibility: grant.data.identity.visibility }) || v.key !== grant.data.identity.finalKey || v.sha256 !== grant.data.verifiedStaging?.sha256 || v.bytes !== grant.data.verifiedStaging?.bytes) bad();
  } else {
    const d = input.data as ImportStageData; stageShape(d);
    if (!s.get('user', d.actorId)) bad();
    if (d.sourceObjectId) {
      const source = s.get('storageObject', d.sourceObjectId);
      if (source?.contextId !== input.contextId || source.data.actorId !== d.actorId || source.data.descriptor.sha256 !== d.sourceHash) bad();
    }
    if (d.sourceStageId) {
      const source = s.get('importStage', d.sourceStageId);
      if (source?.contextId !== input.contextId || source.data.actorId !== d.actorId || source.data.stageType !== 'source' || source.data.sourceHash !== d.sourceHash) bad();
    }
    if (old) {
      const before = old.data as ImportStageData;
      if (!(before.state === 'active' && ['consumed', 'expired'].includes(d.state) || before.state === 'consumed' && d.state === 'expired') || canonical({ ...before, state: d.state, payload: d.state === 'expired' ? null : before.payload }) !== canonical(d)) bad();
    } else {
      if (d.state !== 'active' || s.list('importStage').filter(row => row.data.actorId === d.actorId && row.data.state === 'active' && row.data.expiresAt > d.createdAt).length >= STORAGE_LIMITS.importCount) throw new StoreError('CONFLICT');
    }
  }
}
/** Build a small synchronous view after awaited reads, sharing exactly the same validation rules. */
export function relationView(rows: StoredRecord[], stages: StoredRecord<'importStage'>[], exports: StoredRecord<'importExport'>[] = []): StorageRelationReader {
  return { get: ((kind: RecordKind, id: string) => rows.find(r => r.kind === kind && r.id === id) ?? null) as StorageRelationReader['get'], list: ((kind: RecordKind) => kind === 'importStage' ? stages : kind === 'importExport' ? exports : []) as StorageRelationReader['list'] };
}
