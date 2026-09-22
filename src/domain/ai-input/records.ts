import type { Scope, ExtractionRequest } from './types';
export type AiVisibility = 'context' | 'staff';
export interface SubmissionReference { taskId: string; requestId: string; submissionId: string; productUseIds: string[] }
export interface ProductReference { productId: string; productVersionId: string; contextProductVersionId: string }
export type AssetReference = { kind: 'upload'; assetId: string } | { kind: 'submission_file'; fileVersionId: string };
export interface AiContent { title: string; scope: Scope; kind: ExtractionRequest['kind']; text: string | null; sources: AssetReference[]; selectedPages: number[]; submission: SubmissionReference | null; products: ProductReference[] }
export interface AiInputData { createdBy: string; visibility: AiVisibility; currentVersionId: string | null }
export interface AiVersionData extends AiContent { inputId: string; sequence: number; previousId: string | null; createdBy: string; contentHash: string }
export interface AiAssetData { backend?: import("../storage/types").StorageBackendReference; createdBy: string; visibility: AiVisibility; filename: string; mime: string; bytes: number; sha256: string; storageKey: string }
export type RunState = 'queued' | 'reading' | 'finished' | 'unread' | 'rejected' | 'out_of_scope' | 'failed';
export interface AiRunData { inputId: string; versionId: string; attempt: number; createdBy: string; state: RunState; claimId: string | null; leaseUntil: string | null; startedAt: string | null; endedAt: string | null; snapshotId: string | null; issue: string | null }
/** payload is canonical extraction JSON, never returned without validation/hash verification. */
export interface AiSnapshotData { inputId: string; versionId: string; runId: string; payload: string; snapshotHash: string }
