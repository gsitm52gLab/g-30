import type { AnswerAddress } from '../submissions/types';

/** Exact submitted source. The server must prove every relation in its authenticated UoW. */
export interface ReviewTarget {
    taskId: string;
    submissionId: string;
    requestId: string;
    submissionContentHash: string;
    answer: Pick<AnswerAddress, 'requirementKey' | 'productId'> | null;
    fileVersionIds: string[];
    productUseIds: string[];
    location: { page: string | null; locator: string };
}
export type OpinionSource =
    | { kind: 'internal_review'; reviewer: string; source: string }
    | { kind: 'external_opinion'; agency: string; reviewer: string; source: string }
    | { kind: 'ai_candidate'; runId: string; findingId: string; source: string };
export interface OpinionInput {
    target: ReviewTarget;
    source: OpinionSource;
    originalText: string;
    internalFileVersionIds: string[];
    receivedOn: string | null;
    conflictingOpinionVersionIds: string[];
}
/** Saving an internal opinion appends a version; existing published provenance remains exact. */
export interface OpinionVersionData extends OpinionInput {
    readonly opinionId: string;
    readonly sequence: number;
    readonly previousVersionId: string | null;
    readonly recordedBy: string;
    readonly recordedAt: string;
}
export interface CorrectionItemDraft {
    key: string;
    target: ReviewTarget;
    internalOpinionVersionIds: string[];
    publicSource: string;
    change: string;
    reason: string;
    publicDescription: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    issue: 'correction' | 'conflicting_opinions' | 'wrong_file' | 'missing_content';
}
export interface PendingScope { agency: string; scope: string; expectedOn: string | null }
export interface BatchDraftInput {
    title: string;
    summary: string;
    items: CorrectionItemDraft[];
    mode: 'normal' | 'urgent_partial';
    pendingScopes: PendingScope[];
    previousBatchVersionId: string | null;
}
/** Public content is separate from private opinion provenance; no raw opinion/source objects. */
export type PublishedCorrectionItem = Readonly<Omit<CorrectionItemDraft, 'internalOpinionVersionIds'>>;
export interface PublishedBatchData {
    readonly taskId: string;
    readonly draftId: string;
    readonly draftRevision: number;
    readonly sequence: number;
    readonly title: string;
    readonly summary: string;
    readonly items: readonly PublishedCorrectionItem[];
    readonly mode: BatchDraftInput['mode'];
    readonly pendingScopes: readonly PendingScope[];
    readonly previousBatchVersionId: string | null;
    readonly publishedBy: string;
    readonly publishedAt: string;
    readonly contentHash: string;
}
export interface CommandIdentity { taskId: string; idempotencyKey: string }
export interface SaveOpinionCommand extends CommandIdentity {
    opinionId: string | null;
    expectedRevision: number;
    opinion: OpinionInput;
}
export interface SaveBatchDraftCommand extends CommandIdentity {
    draftId: string | null;
    expectedRevision: number;
    draft: BatchDraftInput;
}
export interface PublishBatchCommand extends CommandIdentity { draftId: string; expectedRevision: number }
export interface ReflectionInput {
    itemKey: string;
    expectedItemRevision: number;
    target: ReviewTarget;
    note: string;
}
export interface ReflectItemsCommand extends CommandIdentity { batchVersionId: string; items: ReflectionInput[] }
export type ResolutionDecision = 'resolved' | 'needs_confirmation' | 'not_reflected';
export interface ResolutionInput {
    itemKey: string;
    expectedItemRevision: number;
    reflectionId: string;
    decision: ResolutionDecision;
    reason: string;
}
export interface ResolveItemsCommand extends CommandIdentity { batchVersionId: string; items: ResolutionInput[] }
/** Append-only facts: publishing or uploading never synthesizes either fact. */
export interface ReflectionFact extends Omit<ReflectionInput, 'expectedItemRevision'> {
    readonly taskId: string;
    readonly batchVersionId: string;
    readonly recordedBy: string;
    readonly recordedAt: string;
}
export interface ResolutionFact extends Omit<ResolutionInput, 'expectedItemRevision'> {
    readonly taskId: string;
    readonly batchVersionId: string;
    readonly resolvedBy: string;
    readonly resolvedAt: string;
}
export interface ReviewScope { medium: string; language: string; usePlace: string; productIds: string[] }
export type ReviewResult = 'no_changes_requested' | 'changes_requested' | 'needs_confirmation' | 'opinion_only';
export interface RecordReviewCommand extends CommandIdentity {
    target: ReviewTarget;
    source: OpinionSource;
    scope: ReviewScope;
    receivedOn: string;
    result: ReviewResult;
    rationale: string;
    evidenceFileVersionIds: string[];
    previousReviewId: string | null;
}
export interface ReviewRecordData extends Omit<RecordReviewCommand, 'idempotencyKey'> {
    readonly recordedBy: string;
    readonly recordedAt: string;
    /** Explicit previous reference is not a result/approval inheritance instruction. */
    readonly previousReviewIsReferenceOnly: true;
}
/** Later G11 consumer: unavailable cannot be mistaken for zero outstanding work. */
export type CorrectionRemainder =
    | { connected: false; reason: 'not_connected' | 'unavailable' }
    | { connected: true; batchVersionIds: string[]; items: { batchVersionId: string; itemKey: string; status: 'pending' | 'reflected' | ResolutionDecision; reflectionId: string | null; resolutionId: string | null }[] };
export const correctionPublishedEvent = 'CORRECTION_BATCH_PUBLISHED' as const;
export interface CorrectionPublishedEvent {
    eventType: typeof correctionPublishedEvent;
    targetId: string; // taskId
    sourceVersionId: string; // immutable batch version ID
    actorId: string;
    at: string;
}
