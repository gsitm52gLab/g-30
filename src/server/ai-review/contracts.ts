export type { Category, Finding, Citation, CorpusRelease, AnalysisIdentity, HumanReviewCommand, ValidatedResult } from '@/domain/ai-review/types';
export type AiReviewList = Awaited<ReturnType<import('./service').AiReviewService['list']>>;
export type AiReviewWorkspace = Awaited<ReturnType<import('./service').AiReviewService['workspace']>>;
export type AiReviewDetail = Awaited<ReturnType<import('./service').AiReviewService['detail']>>;
export type AiReviewCorpus = Awaited<ReturnType<import('./service').AiReviewService['corpus']>>;
export type AiReviewRaw = Awaited<ReturnType<import('./service').AiReviewService['raw']>>;
export type StartAnalysis = { inputVersionId: string; extractionRunId: string; expectedRunId: string | null; corpusReleaseId: string; corpusManifestHash: string; engine: 'synthetic_demo' | 'provider'; idempotencyKey: string };
export type ReviewFinding = import('@/domain/ai-review/types').HumanReviewCommand & { idempotencyKey: string };

export type ProviderSettings = Awaited<ReturnType<import('@/server/ai-provider/service').AiProviderService['settings']>>;
