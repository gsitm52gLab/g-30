import type { DraftContent, Provider } from '@/domain/submissions/types';
import type { SubmissionService } from './service';
export type { SubmissionWorkspace, SubmissionSnapshot, RebasePreview } from './read';
export type { UploadItem, UploadResult } from './files';
export type { AnswerInput, ArtifactInput, DraftContent, ProductSelection, Provider, Evaluation, LinkInput } from '@/domain/submissions/types';
interface DraftWrite {
    expectedDraftRevision: number;
    providedBy?: Provider;
    idempotencyKey: string;
}
export type DraftCommand = DraftWrite & ({
    command: 'save';
    baseRequestId: string;
    content: DraftContent;
} | {
    command: 'rebase_apply';
    baseRequestId: string;
    targetRequestId: string;
    carryAnswers: {
        requirementKey: string;
        productId: string | null;
    }[];
} | {
    command: 'copy_submission';
    baseRequestId: string;
    sourceSubmissionId: string;
});
export interface SubmitCommand {
    baseRequestId: string;
    expectedDraftRevision: number;
    expectedTaskRevision: number;
    mode: 'partial' | 'full';
    idempotencyKey: string;
}
export interface EvaluateCommand {
    baseRequestId: string;
    content: DraftContent;
}
export type EvaluationResult = Awaited<ReturnType<SubmissionService['evaluate']>>;
export interface CommandResult {
    ids: string[];
}
export interface SubmissionError {
    error: {
        code: string;
        message: string;
    };
}
