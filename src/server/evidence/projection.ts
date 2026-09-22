import { asyncMap } from "@/domain/async-collections";
import type { Clock, UnitOfWork } from '@/domain/records';
import type { EvidenceMetadata, EvidenceSource } from '@/domain/evidence/types';
import { assessmentStatuses } from '@/domain/evidence/types';
import type { Principal } from '@/server/auth/service';
import { fileMetadata } from '@/server/files/service';
import { userLabel } from '@/server/submissions/access';
import { resolveEvidenceVersion, visibleLinks } from './access';
const text = (v: unknown) => typeof v === 'string' ? v : '';
const nullable = (v: unknown) => typeof v === 'string' ? v : null;
export function metadataDTO(v: EvidenceMetadata): EvidenceMetadata { return { title: text(v.title), documentType: text(v.documentType), issuer: text(v.issuer), issuedAt: nullable(v.issuedAt), signedAt: nullable(v.signedAt), statedValidFrom: nullable(v.statedValidFrom), statedValidTo: nullable(v.statedValidTo), validityRaw: text(v.validityRaw), language: text(v.language), source: text(v.source) }; }
export function sourceDTO(v: EvidenceSource): EvidenceSource {
    if (v.kind === 'product_binding')
        return { kind: v.kind, productId: text(v.productId), contextProductId: text(v.contextProductId), contextVersionId: text(v.contextVersionId), bindingId: text(v.bindingId), fileVersionId: text(v.fileVersionId) };
    if (v.kind === 'request')
        return { kind: v.kind, taskId: text(v.taskId), requestId: text(v.requestId), fileVersionId: text(v.fileVersionId) };
    return { kind: 'submission', taskId: text(v.taskId), requestId: text(v.requestId), submissionId: text(v.submissionId), requirementKey: nullable(v.requirementKey), productId: nullable(v.productId), fileVersionId: text(v.fileVersionId) };
}
export async function versionDTO(s: UnitOfWork, p: Principal, versionId: string, clock: Clock) {
    const { version: v, file } = (await resolveEvidenceVersion(s, p, versionId, clock)), contextId = v.contextId!;
    const links = (await asyncMap((await visibleLinks(s, p, v, clock)), async ({ link, product }) => ({ id: link.id, revision: link.revision, productId: link.data.productId, contextProductId: link.data.contextProductId, productName: text(product.common.data.common.name), productCode: text(product.common.data.common.code), active: link.data.active === true,
        assessments: (await asyncMap((await s.list('evidenceAssessment', contextId)).filter(a => a.data.linkId === link.id).sort((a, b) => b.data.sequence - a.data.sequence), async (a) => ({ id: a.id, status: assessmentStatuses.includes(a.data.status) ? a.data.status : 'pending' as const, reason: text(a.data.reason), actorLabel: (await userLabel(s, p, contextId, a.data.assessedBy)), at: text(a.data.assessedAt), sequence: a.data.sequence }))),
        file: { ...fileMetadata(file), downloadUrl: `/api/evidence/${encodeURIComponent(v.data.evidenceId)}/file?${new URLSearchParams({ versionId: v.id, linkId: link.id, mode: 'download' })}`, previewUrl: file.data.preview ? `/api/evidence/${encodeURIComponent(v.data.evidenceId)}/file?${new URLSearchParams({ versionId: v.id, linkId: link.id, mode: 'preview' })}` : null } })));
    return { id: v.id, evidenceId: v.data.evidenceId, sequence: v.data.sequence, previousId: nullable(v.data.previousId), source: sourceDTO(v.data.source), metadata: metadataDTO(v.data.metadata), recorderLabel: (await userLabel(s, p, contextId, v.data.recordedBy)), recordedAt: text(v.data.recordedAt), file: { ...fileMetadata(file), uploaderLabel: (await userLabel(s, p, contextId, file.data.uploaderId)), uploadedAt: file.createdAt }, links };
}
