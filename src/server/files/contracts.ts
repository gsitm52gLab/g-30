import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
/** Runs with fresh source + reference authorization in the SAME UoW before/after every range.
 * Exact parent version/inclusion checks belong here; never authorize solely outside byte IO.
 */
export type FileReadAuthorization = (s: UnitOfWork, p: Principal, file: StoredRecord<'fileVersion'>) => Promise<{ authorizationStamp: string }>;
export interface FileReadOptions { extra?: FileReadAuthorization }
export type { DownloadMetadata, TransferFileInput, IssuedUpload } from '@/features/files/contracts';
