import type { EvidenceService } from './service';
import type { EvidenceSource, EvidenceMetadata, AssessmentStatus } from '@/domain/evidence/types';
export type EvidenceSources = Awaited<ReturnType<EvidenceService['sources']>>;
export type { EvidenceList, EvidenceDetail } from './service';
export type { MaterialTable, MaterialCell } from './table';
export type { EvidenceSource, EvidenceMetadata, AssessmentStatus, CellStatus } from '@/domain/evidence/types';
export interface RegisterEvidence {
    contextId: string;
    source: EvidenceSource;
    metadata: EvidenceMetadata;
    productIds: string[];
    idempotencyKey: string;
}
export type EvidenceCommand = { idempotencyKey: string } & (
    { command: 'revise'; expectedRevision: number; source: EvidenceSource; metadata: EvidenceMetadata; productIds: string[] } |
    { command: 'link'; expectedRevision: number; versionId: string; productIds: string[] } |
    { command: 'unlink'; linkId: string; expectedLinkRevision: number } |
    { command: 'assess'; linkId: string; expectedLinkRevision: number; status: AssessmentStatus; reason: string }
);
