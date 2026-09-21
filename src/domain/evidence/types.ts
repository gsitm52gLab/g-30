/** Every source identifies immutable bytes and the exact record that disclosed them. */
export type EvidenceSource = {
    kind: 'product_binding';
    productId: string;
    contextProductId: string;
    contextVersionId: string;
    bindingId: string;
    fileVersionId: string;
} | {
    kind: 'submission';
    taskId: string;
    requestId: string;
    submissionId: string;
    requirementKey: string | null;
    productId: string | null;
    fileVersionId: string;
} | {
    kind: 'request';
    taskId: string;
    requestId: string;
    fileVersionId: string;
};
export interface EvidenceMetadata {
    title: string;
    documentType: string;
    issuer: string;
    issuedAt: string | null;
    signedAt: string | null;
    statedValidFrom: string | null;
    statedValidTo: string | null;
    validityRaw: string;
    language: string;
    source: string;
}
export interface EvidenceData {
    currentVersionId: string | null;
}
export interface EvidenceVersionData {
    evidenceId: string;
    source: EvidenceSource;
    metadata: EvidenceMetadata;
    sequence: number;
    previousId: string | null;
    recordedBy: string;
    recordedAt: string;
}
export const assessmentStatuses = ['pending', 'application_confirmed', 'correction_needed', 'not_applicable'] as const;
export type AssessmentStatus = typeof assessmentStatuses[number];
export interface EvidenceLinkData {
    evidenceVersionId: string;
    productId: string;
    contextProductId: string;
    active: boolean;
    currentAssessmentId: string | null;
}
export interface EvidenceAssessmentData {
    linkId: string;
    status: AssessmentStatus;
    reason: string;
    assessedBy: string;
    assessedAt: string;
    sequence: number;
    previousId: string | null;
}
export type CellStatus = 'missing' | 'submitted' | 'content_confirmation' | 'application_confirmed' | 'correction_needed' | 'not_applicable';
export interface MaterialCounts {
    connected: true;
    requested: number;
    missing: number;
    unconfirmed: number;
}
export const evidenceNotice = '적용 확인은 이 자료와 상품의 관계에 대한 사람의 확인입니다. 인증 승인 또는 현재 인증 유효성을 뜻하지 않습니다.';
export function blankEvidenceMetadata(): EvidenceMetadata { return { title: '', documentType: '', issuer: '', issuedAt: null, signedAt: null, statedValidFrom: null, statedValidTo: null, validityRaw: '', language: '', source: '' }; }
