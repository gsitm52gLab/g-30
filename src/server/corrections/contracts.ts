export type { CorrectionCommand,CorrectionWorkspace,CorrectionBatch,CorrectionPreview } from './service';
export type { ReviewTarget,OpinionInput,OpinionSource,BatchDraftInput,CorrectionItemDraft,ReflectionInput,ResolutionInput,RecordReviewCommand } from '@/domain/corrections/types';
export interface CorrectionCommandResult { ids:string[] }
export interface CorrectionError { error:{code:string;message:string} }
