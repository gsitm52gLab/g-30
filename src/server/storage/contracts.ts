import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { StorageBinding, UploadInput, StorageCommitResult, VerifiedDescriptor } from '@/domain/storage/types';
import type { SupabasePrivateStorage } from './supabase';
export type StorageTransport = Pick<SupabasePrivateStorage, 'allocateStagingKey' | 'allocateFinalKey' | 'issueUploadGrant' | 'readSnapshot' | 'promoteVerified' | 'inspect' | 'readRange' | 'cleanupExpiredStaging'>;
export type StorageAction = 'issue' | 'status' | 'finalize' | 'read' | 'cleanup';
/** Mandatory exact feature authorization: no generic context-only fallback exists in the core. */
export interface StorageHooks<Credentials, Validated> {
  authorize(s: UnitOfWork, credentials: Credentials, binding: StorageBinding, action: StorageAction): Promise<{ actorId: string }>;
  /** Runs outside a DB transaction on already byte/hash/type-checked input; apply purpose-specific rules here. */
  validate(input: UploadInput, bytes: Buffer): Promise<Validated>;
  /** Same UoW: feature row with backend reference + existing receipt + exact G14 auditOperation/appendAudit. */
  commit(s: UnitOfWork, input: {
    grant: StoredRecord<'storageUploadGrant'>; object: StoredRecord<'storageObject'>;
    descriptor: VerifiedDescriptor; validated: Validated;
  }): Promise<StorageCommitResult>;
}
export type StorageCoreCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'PENDING' | 'RECOVERY_REQUIRED' | 'REJECTED' | 'STAGING_LIMIT';
export class StorageCoreError extends Error {
  readonly status: number;
  constructor(readonly code: StorageCoreCode) {
    super(`Storage request could not complete (${code}).`);
    this.name = 'StorageCoreError';
    this.status = code === 'NOT_FOUND' ? 404 : code === 'EXPIRED' ? 410 : ['INVALID_INPUT', 'REJECTED', 'STAGING_LIMIT'].includes(code) ? 422 : 409;
  }
}
