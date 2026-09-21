import type { RequirementType } from '../tasks/types';
export type Provider = {
    kind: 'user';
    userId: string;
} | {
    kind: 'external_source';
    label: string;
    source: string;
};
export interface Provenance {
    providedBy: Provider;
    recordedBy: string;
    at: string;
    originSubmissionId: string | null;
}
export interface AnswerAddress {
    requestId: string;
    requirementKey: string;
    productId: string | null;
}
export interface DateInput {
    value: string;
    precision: 'date' | 'datetime';
    timezone: string;
}
export interface LinkInput {
    url: string;
    description: string;
    contentFixed: false;
    fixedReference: {
        kind: 'file';
        fileVersionId: string;
    } | {
        kind: 'external';
        identifier: string;
        source: string;
    } | null;
}
export interface PhysicalInput {
    summary: string;
    items: {
        productId: string | null;
        quantity: string;
        unit: string;
    }[];
    evidenceFileVersionIds: string[];
    observedAt: DateInput | null;
    source: string;
}
export interface Inputs {
    short_text: {
        text: string;
    };
    long_text: {
        text: string;
    };
    file: {
        fileVersionIds: string[];
    };
    choice: {
        selected: string[];
    };
    number: {
        value: string;
    };
    date: DateInput;
    link: LinkInput;
    physical_record: PhysicalInput;
}
export type AnswerInput = {
    [K in RequirementType]: AnswerAddress & {
        type: K;
        input: Inputs[K];
    };
}[RequirementType];
export type StoredAnswer = AnswerInput & {
    provenance: Provenance;
};
export interface ArtifactInput {
    fileVersionId: string;
    role: 'editable_original' | 'review_copy' | 'evidence';
    answer: Pick<AnswerAddress, 'requirementKey' | 'productId'> | null;
}
export interface ProductSelection {
    productId: string;
    expectedCommonRevision: number;
    expectedContextRevision: number;
    bindingIds: string[];
    retailPriceVersionId: string | null;
    asOfDate: string;
}
export interface DraftContent {
    answers: AnswerInput[];
    narrative: string;
    artifacts: ArtifactInput[];
    links: LinkInput[];
    productSelections: ProductSelection[];
}
export interface SubmissionDraftData extends Omit<DraftContent, 'answers'> {
    taskId: string;
    baseRequestId: string;
    baseSubmissionId: string | null;
    answers: StoredAnswer[];
    providedBy: Provider;
    lastEditedBy: string;
    lastEditedAt: string;
}
export interface AnswerIssue {
    code: string;
    message: string;
}
export interface RequirementEvaluation {
    requirementKey: string;
    productId: string | null;
    label: string;
    type: RequirementType;
    required: boolean;
    status: 'not_applicable' | 'needs_reconfirmation' | 'received' | 'prior_received' | 'missing' | 'optional' | 'invalid';
    validity: 'empty' | 'invalid' | 'valid';
    issues: AnswerIssue[];
    humanReviewPending: boolean;
    warnings: string[];
    sourceRequestId: string | null;
}
export interface Evaluation {
    items: RequirementEvaluation[];
    required: number;
    satisfied: number;
    missing: number;
    invalid: number;
    canSubmitFull: boolean;
    humanReviewPending: boolean;
}
export interface FrozenFile {
    fileVersionId: string;
    name: string;
    bytes: number;
    mime: string;
    sha256: string;
    preview: boolean;
    uploaderId: string;
    uploadedAt: string;
}
export interface SubmissionData extends Omit<SubmissionDraftData, 'baseRequestId' | 'lastEditedBy' | 'lastEditedAt'> {
    requestId: string;
    sequence: number;
    previousId: string | null;
    draftId: string;
    committedDraftRevision: number;
    mode: 'partial' | 'full';
    files: FrozenFile[];
    fileVersionIds: string[];
    productUseIds: string[];
    evaluation: Evaluation;
    recordedBy: string;
    submittedAt: string;
    contentHash: string;
}
export const answerKey = (answer: Pick<AnswerAddress, 'requirementKey' | 'productId'>) => JSON.stringify([answer.requirementKey, answer.productId]);
export function blankInput(type: RequirementType): Inputs[RequirementType] {
    switch (type) {
        case 'short_text':
        case 'long_text': return { text: '' };
        case 'choice': return { selected: [] };
        case 'file': return { fileVersionIds: [] };
        case 'number': return { value: '' };
        case 'date': return { value: '', precision: 'date', timezone: 'Asia/Seoul' };
        case 'link': return { url: '', description: '', contentFixed: false, fixedReference: null };
        case 'physical_record': return { summary: '', items: [], evidenceFileVersionIds: [], observedAt: null, source: '' };
    }
}
export const blankDraft = (): DraftContent => ({ answers: [], narrative: '', artifacts: [], links: [], productSelections: [] });
