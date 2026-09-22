import { RequestError } from '@/features/tasks/client';
import type { GrantStatus, UploadCapability } from '@/domain/storage/types';
/** Feature endpoints resolve context/owner themselves; the browser never supplies a storage key. */
export interface TransferFileInput {
  clientItemId: string; originalName: string; declaredMime: string; expectedBytes: number; expectedSha256: string;
}
export interface IssuedUpload { status: GrantStatus; capability: UploadCapability | null }
export interface DirectUploadCallbacks<T> {
  issue(input: TransferFileInput, signal?: AbortSignal): Promise<IssuedUpload>;
  status(id: string, signal?: AbortSignal): Promise<GrantStatus>;
  finalize(id: string, signal?: AbortSignal): Promise<GrantStatus>;
  /** Resolve a ready record using the feature's current-authorized DTO endpoint. */
  resolve(status: GrantStatus, signal?: AbortSignal): Promise<T>;
}
/** Exact immutable bytes, not a Storage key or signed download capability. */
export interface DownloadMetadata {
  id: string; name: string; mime: string; bytes: number; sha256: string;
  etag: string; chunkBytes: number; downloadUrl: string;
}
export class FileTransferError extends RequestError {
  constructor(readonly code: 'INVALID_INPUT' | 'EXPIRED' | 'TRANSFER_FAILED' | 'NOT_READY' | 'INTEGRITY' | 'ACCESS_CHANGED' | 'ABORTED', status = code === 'ACCESS_CHANGED' ? 404 : code === 'INVALID_INPUT' ? 422 : 503) {
    super(code === 'ACCESS_CHANGED' ? '파일에 접근할 수 없습니다. 현재 권한을 확인해 주세요.' : code === 'INTEGRITY' ? '파일 내용을 확인하지 못했습니다. 다시 시도해 주세요.' : code === 'ABORTED' ? '파일 처리를 취소했습니다.' : '파일 처리를 완료하지 못했습니다. 이 파일만 다시 시도해 주세요.', status, code);
    this.name = 'FileTransferError';
  }
}
