/** Private storage records. Keys, capabilities and descriptors are never ordinary page DTOs. */
export const STORAGE_LIMITS = {
  generalBytes: 25 * 1024 * 1024, batchFiles: 10, specificBytes: 10 * 1024 * 1024,
  aiImages: 4, aiPages: 10, chunkBytes: 4 * 1024 * 1024,
  grantMs: 15 * 60_000, leaseMs: 10 * 60_000, cleanupMs: 24 * 3600_000 + 5 * 60_000,
  importBytes: 64 * 1024 * 1024, importCount: 50, sourceMs: 24 * 3600_000, previewMs: 30 * 60_000,
} as const;
export type StorageOwner =
  | { purpose: 'task_reference'; taskId: string }
  | { purpose: 'product'; productId: string; contextProductId: string }
  | { purpose: 'notice'; noticeId: string }
  | { purpose: 'submission'; taskId: string; requestId: string }
  | { purpose: 'inquiry'; conversationId: string }
  | { purpose: 'ai_asset'; inputKind: 'pdf' | 'image' }
  | { purpose: 'import_source' };
export interface StorageBinding { contextId: string; owner: StorageOwner; visibility: 'public' | 'internal' }
export interface UploadInput extends StorageBinding {
  clientItemId: string; originalName: string; declaredMime: string; expectedBytes: number; expectedSha256: string;
}
export interface UploadIdentity extends UploadInput {
  actorId: string; dedupeKey: string; bodyHash: string; stagingKey: string; finalKey: string; issuedAt: number;
}
export type GrantState = 'issuing' | 'issued' | 'finalizing' | 'ready' | 'rejected' | 'recovery_required' | 'cleanup_claimed' | 'cleaned';
export interface StorageDescriptor { key: string; id: string; version: string; bytes: number; etag: string; contentType: string }
export interface VerifiedDescriptor extends StorageDescriptor { sha256: string; originalName: string; mime: string; preview: boolean }
export interface UploadCapability {
  key: string; bucket: string; signedUrl: string; token: string; method: 'PUT'; resumableEndpoint: string;
  tusChunkBytes: number; appExpiresAt: number; storageExpiresAt: number; safeCleanupAfter: number;
  expectedBytes: number; bucketMaxBytes: number;
}
export type StorageRecordReference = { kind: 'fileVersion' | 'aiAsset' | 'importStage'; id: string };
export interface StorageCommitResult { record: StorageRecordReference; receiptId: string; auditIds: string[] }
export interface StorageGrantData {
  identity: UploadIdentity; state: GrantState; claim: { id: string; until: number } | null;
  appExpiresAt: number; storageExpiresAt: number | null; safeCleanupAfter: number;
  capability: UploadCapability | null; promotionStarted: boolean; verifiedStaging: VerifiedDescriptor | null;
  finalObject: VerifiedDescriptor | null; objectId: string; result: StorageCommitResult | null;
  failure: 'REJECTED' | 'REMOTE_UNKNOWN' | 'RECOVERY_REQUIRED' | null;
}
export interface StorageObjectData {
  grantId: string; actorId: string; binding: StorageBinding; descriptor: VerifiedDescriptor;
}
export interface StorageBackendReference { kind: 'supabase'; objectId: string }
/** Parsed import JSON is private shared state, not a generic uploaded file. */
export interface ImportStageData {
  stageType: 'source' | 'preview'; actorId: string; sourceObjectId: string | null; sourceStageId: string | null;
  sourceHash: string; createdAt: number; expiresAt: number; payload: string | null; payloadHash: string;
  state: 'active' | 'consumed' | 'expired';
}
export interface StorageRecords {
  storageUploadGrant: StorageGrantData; storageObject: StorageObjectData; importStage: ImportStageData; importExport: ImportExportData;
}
/** Private ordered parts of one generated workbook; never projected into a page or audit DTO. */
export interface ImportExportData {
  actorId: string; includeInternal: boolean; filename: string; mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  createdAt: number; totalBytes: number; sha256: string;
  parts: { start: number; descriptor: VerifiedDescriptor }[];
}
/** Safe generic status. Feature DTO production still belongs to the current-authorized caller. */
export interface GrantStatus {
  id: string; revision: number; state: GrantState; expiresAt: number;
  result: StorageRecordReference | null; failure: StorageGrantData['failure'];
}

/** Metadata is validated for the entire batch before issuing. Remote per-file failures retain successes. */
export type BatchGrantResult =
  | { clientItemId: string; ok: true; status: GrantStatus; capability: UploadCapability | null }
  | { clientItemId: string; ok: false; error: 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'PENDING' | 'REJECTED' | 'RETRY_REQUIRED' };
