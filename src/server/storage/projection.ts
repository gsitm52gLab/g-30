import type { StoredRecord } from '@/domain/records';
import type { GrantStatus, UploadCapability } from '@/domain/storage/types';
import { grantShape, capabilityShape } from '@/domain/storage/validate';
export function grantStatus(row: StoredRecord<'storageUploadGrant'>): GrantStatus {
  grantShape(row.data);
  const d = row.data;
  return { id: row.id, revision: row.revision, state: d.state, expiresAt: d.appExpiresAt,
    result: d.result ? { kind: d.result.record.kind, id: d.result.record.id } : null, failure: d.failure };
}
/** This is an upload-only capability response; never spread a persisted object into the public reply. */
export function uploadCapability(v: UploadCapability): UploadCapability {
  capabilityShape(v);
  return { key: v.key, bucket: v.bucket, signedUrl: v.signedUrl, token: v.token, method: 'PUT', resumableEndpoint: v.resumableEndpoint, tusChunkBytes: v.tusChunkBytes, appExpiresAt: v.appExpiresAt, storageExpiresAt: v.storageExpiresAt, safeCleanupAfter: v.safeCleanupAfter, expectedBytes: v.expectedBytes, bucketMaxBytes: v.bucketMaxBytes };
}
