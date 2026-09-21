import type { BatchDraftInput, OpinionVersionData, PublishedBatchData, ReflectionFact, ResolutionFact, ReviewRecordData } from './types';
export interface CorrectionOpinionData { taskId: string; currentVersionId: string | null }
export interface CorrectionDraftData { taskId: string; draft: BatchDraftInput; publishedVersionId: string | null; createdBy: string }
export interface CorrectionItemStateData { taskId: string; batchVersionId: string; itemKey: string; reflectionId: string; resolutionId: string | null }
export interface CorrectionRecords {
    correctionOpinion: CorrectionOpinionData;
    correctionOpinionVersion: OpinionVersionData;
    correctionDraft: CorrectionDraftData;
    correctionBatch: PublishedBatchData;
    correctionItemState: CorrectionItemStateData;
    correctionReflection: ReflectionFact & { itemRevision: number };
    correctionResolution: ResolutionFact & { itemRevision: number };
    correctionReview: ReviewRecordData;
}
