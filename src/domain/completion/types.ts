import type { CampaignCompletionRemainder } from './campaign';
import type { AiCompletionRemainder } from '../ai-review/completion';
import type { TaskData } from '../records';
import type { QuestionDTO } from '../inquiries/types';
export type Available<T> = {
    connected: true;
    state: 'available';
    value: T;
} | {
    connected: true;
    state: 'unavailable';
    value: null;
    reason: 'source_unavailable';
};
export type Unconnected = {
    connected: false;
    state: 'not_connected';
    value: null;
};
export interface EvaluationFact {
    required: number;
    satisfied: number;
    missing: number;
    invalid: number;
    humanReviewPending: boolean;
}
export interface InquiryFact {
    conversationId: string;
    questionId: string;
    revision: number;
    text: string;
    state: QuestionDTO['state'];
    externalWait: QuestionDTO['externalWait'];
}
export interface CorrectionFact {
    batchVersionId: string;
    itemKey: string;
    targetSubmissionId: string;
    status: 'pending' | 'needs_confirmation' | 'reflected' | 'resolved' | 'not_reflected';
    reflectionId: string | null;
    resolutionId: string | null;
}
export interface ProductUseFact {
    id: string;
    productId: string;
    productVersionId: string;
    contextProductVersionId: string;
    retailPriceVersionId: string | null;
    contentHash: string;
    fileBindingHash: string;
}
export interface CompletionBasis {
    currentRequest: {
        id: string;
        sequence: number;
    } | null;
    currentRequestUnavailable: boolean;
    latestSubmission: {
        id: string;
        requestId: string;
        sequence: number;
        mode: 'partial' | 'full';
        contentHash: string;
        submittedAt: string;
        fileVersionIds: string[];
        products: Available<ProductUseFact[]>;
    } | null;
    latestMatchesCurrentRequest: boolean | null;
    currentEvaluation: Available<EvaluationFact>;
    originalSubmittedEvaluation: Available<EvaluationFact>;
    currentProducts: Available<{
        productId: string;
        productVersionId: string;
        contextProductVersionId: string;
        commonRevision: number;
        contextRevision: number;
    }[]>;
    inquiries: Available<{
        items: InquiryFact[];
        unresolved: number;
        externalWaiting: number;
    }>;
    corrections: Available<{
        items: CorrectionFact[];
        unresolved: number;
        pendingScopes: {
            batchVersionId: string;
            agency: string;
            scope: string;
            expectedOn: string | null;
        }[];
    }>;
    externalActions: {
        id: string;
        visibility: 'public' | 'internal';
        purpose: ExternalPurpose;
        latestProgress: string;
        waitingExternal: boolean;
        observedAt: ObservedTime | null;
        recordedAt: string;
    }[];
    campaign: Unconnected | Available<CampaignCompletionRemainder>;
    ai: Unconnected | Available<AiCompletionRemainder>;
}
export type ExternalPurpose = 'review_request' | 'application' | 'final_use';
export type ExternalActor = {
    kind: 'user';
    userId: string;
} | {
    kind: 'external';
    label: string;
    source: string;
};
export interface ObservedTime {
    value: string;
    precision: 'date' | 'datetime';
    timezone: string;
    source: string;
}
export interface ExactSource {
    requestId: string;
    submissionId: string | null;
    submissionContentHash: string | null;
    fileVersionIds: string[];
    productUseIds: string[];
}
export interface ExternalActionInput {
    purpose: ExternalPurpose;
    destination: string;
    requester: ExternalActor;
    performer: ExternalActor;
    source: ExactSource;
    observedAt: ObservedTime | null;
    evidenceFileVersionIds: string[];
    latestProgress: string;
    waitingExternal: boolean;
    visibility: 'public' | 'internal';
}
export interface CompletionRecords {
    completionSnapshot: {
        taskId: string;
        sequence: number;
        previousCompletionId: string | null;
        basisHash: string;
        taskRevision: number;
        statusBefore: TaskData['status'];
        basis: CompletionBasis;
        memo: string;
        completedBy: string;
        completedAt: string;
    };
    completionReopen: {
        taskId: string;
        completionId: string;
        reason: string;
        resumedStatus: TaskData['status'];
        reopenedBy: string;
        reopenedAt: string;
    };
    completionExternalAction: ExternalActionInput & {
        taskId: string;
        sequence: number;
        recordedBy: string;
        recordedAt: string;
    };
    completionFollowup: {
        taskId: string;
        completionId: string;
        followupTaskId: string;
        reason: string;
        linkedBy: string;
        linkedAt: string;
    };
}
