import type { AnalysisIdentity, HumanReviewCommand } from './types';
export type AnalysisState = 'queued' | 'running' | 'finished' | 'failed';
export type AnalysisIssue = 'ENGINE_ERROR' | 'RESULT_INVALID' | 'ACCESS_CHANGED' | 'SOURCE_CHANGED' | 'CORPUS_CHANGED' | 'INTERRUPTED' | 'STORAGE_UNAVAILABLE';
/** Corpus source/excerpt/translation versions live inside the immutable, hash-bound release payload. */
export interface AiReviewRecords {
  aiCorpusRelease: { payload: string; manifestHash: string };
  aiCorpusHead: { releaseId: string };
  aiAnalysisRun: AnalysisIdentity & {
    taskId: string | null; createdBy: string; attempt: number; previousRunId: string | null; providerCalled: boolean;
    state: AnalysisState; claimId: string | null; leaseUntil: string | null;
    startedAt: string | null; endedAt: string | null; resultId: string | null; issue: AnalysisIssue | null;
  };
  aiAnalysisResult: { runId: string; raw: string; rawHash: string; payload: string; resultHash: string };
  aiFindingReview: { runId: string; resultId: string; findingId: string; currentActionId: string | null };
  aiFindingReviewAction: Omit<HumanReviewCommand, 'expectedRevision'> & {
    runId: string; resultId: string; reviewId: string; previousActionId: string | null;
    sequence: number; reviewedBy: string; reviewedAt: string;
  };
}
