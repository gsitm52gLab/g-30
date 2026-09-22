import { createHash } from 'node:crypto';
import { StoreError } from '../records';
import { validateFileMetadata, validateFile } from '../files/validate';
import { preflight } from '../ai-input/preflight';
import { STORAGE_LIMITS, type UploadInput, type StorageOwner, type VerifiedDescriptor, type StorageGrantData, type ImportStageData, type UploadCapability, type StorageCommitResult } from './types';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v);
export const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const millis = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function owner(input: StorageOwner): StorageOwner {
  const bad = () => { throw new StoreError('INVALID_RECORD'); };
  if (!input || typeof input !== 'object') return bad();
  switch (input.purpose) {
    case 'task_reference': if (id(input.taskId)) return { purpose: input.purpose, taskId: input.taskId }; break;
    case 'product': if (id(input.productId) && id(input.contextProductId)) return { purpose: input.purpose, productId: input.productId, contextProductId: input.contextProductId }; break;
    case 'notice': if (id(input.noticeId)) return { purpose: input.purpose, noticeId: input.noticeId }; break;
    case 'submission': if (id(input.taskId) && id(input.requestId)) return { purpose: input.purpose, taskId: input.taskId, requestId: input.requestId }; break;
    case 'inquiry': if (id(input.conversationId)) return { purpose: input.purpose, conversationId: input.conversationId }; break;
    case 'ai_asset': if (['pdf', 'image'].includes(input.inputKind)) return { purpose: input.purpose, inputKind: input.inputKind }; break;
    case 'import_source': return { purpose: input.purpose };
  }
  return bad();
}
export function uploadInput(v: UploadInput): UploadInput {
  if (!v || !id(v.contextId) || !id(v.clientItemId) || !['public', 'internal'].includes(v.visibility) ||
      typeof v.originalName !== 'string' || !v.originalName || v.originalName.length > 240 || /[\x00-\x1f\x7f/\\]/.test(v.originalName) || ['.', '..'].includes(v.originalName) ||
      typeof v.declaredMime !== 'string' || v.declaredMime.length > 256 || /[\x00-\x1f\x7f]/.test(v.declaredMime) || !sha(v.expectedSha256)) throw new StoreError('INVALID_RECORD');
  const scope = owner(v.owner), maximum = ['ai_asset', 'import_source'].includes(scope.purpose) ? STORAGE_LIMITS.specificBytes : STORAGE_LIMITS.generalBytes;
  if (!Number.isSafeInteger(v.expectedBytes) || v.expectedBytes < 1 || v.expectedBytes > maximum) throw new StoreError('INVALID_RECORD');
  if (scope.purpose === 'import_source' && !/\.xlsx$/i.test(v.originalName) || scope.purpose === 'ai_asset' && !(scope.inputKind === 'pdf' ? /\.pdf$/i : /\.(png|jpe?g|webp)$/i).test(v.originalName)) throw new StoreError('INVALID_RECORD');
  const aiWebp = scope.purpose === 'ai_asset' && scope.inputKind === 'image' && /\.webp$/i.test(v.originalName);
  if (aiWebp) { if (v.declaredMime !== 'image/webp') throw new StoreError('INVALID_RECORD'); }
  else try { validateFileMetadata(v.originalName, v.declaredMime, v.expectedBytes); } catch { throw new StoreError('INVALID_RECORD'); }
  return { contextId: v.contextId, owner: scope, visibility: v.visibility, clientItemId: v.clientItemId, originalName: v.originalName, declaredMime: v.declaredMime, expectedBytes: v.expectedBytes, expectedSha256: v.expectedSha256 };
}
/** Existing G15 WebP support is purpose-specific; ordinary file MIME admission is unchanged. */
export function aiWebpFile(name: string, mime: string, bytes: Buffer) {
  const valid = preflight({ scope: { classification: 'general_cosmetic', language: 'ja', media: 'pop', use: 'upload validation' }, kind: 'images', sources: [{ sourceId: 'storage', versionId: 'storage', contextId: 'storage', filename: name, mime, bytes, sha256: digest(bytes) }] });
  if (!valid.ok || !/\.webp$/i.test(name) || mime !== 'image/webp') throw new StoreError('INVALID_RECORD');
  return { name, mime: 'image/webp', preview: true };
}
export function storageFile(input: Pick<UploadInput, 'owner' | 'originalName' | 'declaredMime'>, bytes: Buffer) {
  return input.owner.purpose === 'ai_asset' && input.owner.inputKind === 'image' && /\.webp$/i.test(input.originalName) ? aiWebpFile(input.originalName, input.declaredMime, bytes) : validateFile(input.originalName, input.declaredMime, bytes);
}
export function descriptor(v: VerifiedDescriptor, lane: 'staging' | 'final'): VerifiedDescriptor {
  if (!v || typeof v.key !== 'string' || !new RegExp(`^[a-z0-9][a-z0-9_-]{0,63}/${lane}/${UUID}$`).test(v.key) || !id(v.id) || !id(v.version) || !Number.isSafeInteger(v.bytes) || v.bytes < 1 || v.bytes > STORAGE_LIMITS.generalBytes || !sha(v.sha256) || typeof v.etag !== 'string' || !/^"[a-f0-9]{32}(?:-\d+)?"$/.test(v.etag) || typeof v.contentType !== 'string' || v.contentType.length > 256 || typeof v.mime !== 'string' || v.mime.length > 256 || typeof v.originalName !== 'string' || v.originalName.length > 240 || typeof v.preview !== 'boolean') throw new StoreError('INVALID_RECORD');
  return { key: v.key, id: v.id, version: v.version, bytes: v.bytes, etag: v.etag, contentType: v.contentType, sha256: v.sha256, originalName: v.originalName, mime: v.mime, preview: v.preview };
}
export function capabilityShape(v: UploadCapability) {
  if (!v || typeof v.key !== 'string' || typeof v.bucket !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(v.bucket) ||
      typeof v.signedUrl !== 'string' || v.signedUrl.length > 16384 || typeof v.token !== 'string' || !v.token || v.token.length > 8192 ||
      typeof v.resumableEndpoint !== 'string' || v.resumableEndpoint.length > 2048 || v.method !== 'PUT' || v.tusChunkBytes !== 6 * 1024 * 1024 ||
      ![v.appExpiresAt, v.storageExpiresAt, v.safeCleanupAfter, v.expectedBytes, v.bucketMaxBytes].every(x => Number.isSafeInteger(x) && x > 0) ||
      v.expectedBytes > STORAGE_LIMITS.generalBytes || v.bucketMaxBytes > STORAGE_LIMITS.generalBytes || v.expectedBytes > v.bucketMaxBytes) throw new StoreError('INVALID_RECORD');
  for (const url of [v.signedUrl, v.resumableEndpoint]) {
    try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw Error(); } catch { throw new StoreError('INVALID_RECORD'); }
  }
}
export function resultShape(v: StorageCommitResult) {
  if (!v || !v.record || !['fileVersion', 'aiAsset', 'importStage'].includes(v.record.kind) || !id(v.record.id) || !id(v.receiptId) ||
      !Array.isArray(v.auditIds) || !v.auditIds.length || v.auditIds.length > 100 || v.auditIds.some(x => !id(x))) throw new StoreError('INVALID_RECORD');
}
export function grantShape(v: StorageGrantData) {
  const bad = () => { throw new StoreError('INVALID_RECORD'); };
  if (!v?.identity) bad();
  const i = v.identity, input = uploadInput(i);
  if (!id(i.actorId) || !sha(i.bodyHash) || !sha(i.dedupeKey) || i.bodyHash !== digest(canonical(input)) || !millis(i.issuedAt) || !id(v.objectId) || !millis(v.appExpiresAt) || v.appExpiresAt !== i.issuedAt + STORAGE_LIMITS.grantMs || !millis(v.safeCleanupAfter) || v.safeCleanupAfter < i.issuedAt + STORAGE_LIMITS.cleanupMs || v.storageExpiresAt !== null && (!millis(v.storageExpiresAt) || v.safeCleanupAfter < v.storageExpiresAt + 5 * 60_000)) bad();
  for (const lane of ['staging', 'final'] as const) if (!new RegExp(`^[a-z0-9][a-z0-9_-]{0,63}/${lane}/${UUID}$`).test(i[`${lane}Key`])) bad();
  if (!['issuing', 'issued', 'finalizing', 'ready', 'rejected', 'recovery_required', 'cleanup_claimed', 'cleaned'].includes(v.state) || v.claim && (!id(v.claim.id) || !millis(v.claim.until)) || ![null, 'REJECTED', 'REMOTE_UNKNOWN', 'RECOVERY_REQUIRED'].includes(v.failure)) bad();
  if (v.verifiedStaging) { const d = descriptor(v.verifiedStaging, 'staging'); if (d.key !== i.stagingKey || d.sha256 !== i.expectedSha256 || d.bytes !== i.expectedBytes) bad(); }
  if (v.finalObject) { const d = descriptor(v.finalObject, 'final'); if (d.key !== i.finalKey || !v.verifiedStaging || d.sha256 !== v.verifiedStaging.sha256 || d.bytes !== v.verifiedStaging.bytes) bad(); }
  if (typeof v.promotionStarted !== 'boolean' || v.promotionStarted && !v.verifiedStaging || v.state !== 'ready' && v.result !== null) bad();
  if (v.state === 'ready' && (!v.finalObject || !v.result || v.claim !== null)) bad();
  if (v.result) resultShape(v.result);
  if (['issuing', 'finalizing', 'cleanup_claimed'].includes(v.state) !== (v.claim !== null)) bad();
  if (v.state === 'issued' && !v.capability) bad();
  if (v.capability) capabilityShape(v.capability);
  if (v.capability && (v.capability.key !== i.stagingKey || v.capability.expectedBytes !== i.expectedBytes || v.capability.appExpiresAt !== v.appExpiresAt || v.capability.storageExpiresAt !== v.storageExpiresAt || v.capability.safeCleanupAfter > v.safeCleanupAfter || typeof v.capability.token !== 'string' || v.capability.token.length > 8192 || typeof v.capability.signedUrl !== 'string' || v.capability.signedUrl.length > 16384)) bad();
}
export function stageShape(v: ImportStageData) {
  if (!v || !['source', 'preview'].includes(v.stageType) || !id(v.actorId) || !sha(v.sourceHash) || !sha(v.payloadHash) || !millis(v.createdAt) || v.expiresAt !== v.createdAt + (v.stageType === 'source' ? STORAGE_LIMITS.sourceMs : STORAGE_LIMITS.previewMs) || !['active', 'consumed', 'expired'].includes(v.state) || v.sourceObjectId !== null && !id(v.sourceObjectId) || v.sourceStageId !== null && !id(v.sourceStageId)) throw new StoreError('INVALID_RECORD');
  if (v.payload === null) { if (v.state !== 'expired') throw new StoreError('INVALID_RECORD'); }
  else {
    if (typeof v.payload !== 'string' || Buffer.byteLength(v.payload) > STORAGE_LIMITS.importBytes || digest(v.payload) !== v.payloadHash) throw new StoreError('INVALID_RECORD');
    try { const parsed = JSON.parse(v.payload); if (!parsed || typeof parsed !== 'object') throw Error(); } catch { throw new StoreError('INVALID_RECORD'); }
  }
}
export function exportShape(v: import('./types').ImportExportData) {
  if (!v || !id(v.actorId) || typeof v.includeInternal !== 'boolean' || !millis(v.createdAt) || !sha(v.sha256) || !Number.isSafeInteger(v.totalBytes) || v.totalBytes < 1 || v.mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || typeof v.filename !== 'string' || !/^[A-Za-z0-9_-]+\.xlsx$/.test(v.filename) || v.filename.length > 240 || !Array.isArray(v.parts) || !v.parts.length) throw new StoreError('INVALID_RECORD');
  const keys = new Set<string>(), ids = new Set<string>(); let offset = 0;
  for (const part of v.parts) {
    const d = descriptor(part.descriptor, 'final');
    if (part.start !== offset || d.bytes > STORAGE_LIMITS.chunkBytes || keys.has(d.key) || ids.has(d.id) || d.mime !== v.mime || d.originalName !== v.filename || d.preview) throw new StoreError('INVALID_RECORD');
    offset += d.bytes; if (!Number.isSafeInteger(offset)) throw new StoreError('INVALID_RECORD'); keys.add(d.key); ids.add(d.id);
  }
  if (offset !== v.totalBytes) throw new StoreError('INVALID_RECORD');
}
