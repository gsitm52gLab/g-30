import type { Clock, UnitOfWork } from '@/domain/records';
import type { EvidenceSource, EvidenceMetadata } from '@/domain/evidence/types';
import { blankEvidenceMetadata } from '@/domain/evidence/types';
import { answerFiles } from '@/domain/submissions/files';
import { answerDTO } from '@/server/submissions/projection';
import type { Principal } from '@/server/auth/service';
import { fileMetadata, fileUrls, sourceReference } from '@/server/files/service';
import { userLabel } from '@/server/submissions/access';
import { authorize } from '@/server/policy/policy';
import { evidenceScope, resolveSource } from './access';
import { sourceDTO, metadataDTO } from './projection';
export function sourceChoices(s: UnitOfWork, p: Principal, contextId: string, clock: Clock) {
    authorize(s, p, 'evidence.read', evidenceScope(contextId), clock);
    const candidates: {
        source: EvidenceSource;
        metadata: EvidenceMetadata;
        label: string;
    }[] = [];
    for (const version of s.list('contextProductVersion', contextId)) {
        const cp = s.get('contextProduct', version.data.contextProductId);
        if (!cp)
            continue;
        for (const b of version.data.files)
            candidates.push({ source: { kind: 'product_binding', productId: cp.data.productId, contextProductId: cp.id, contextVersionId: version.id, bindingId: b.id, fileVersionId: b.fileVersionId }, metadata: metadataDTO(b), label: `상품 자료 v${version.data.sequence}` });
    }
    for (const request of s.list('requestVersion', contextId))
        for (const fileVersionId of request.data.content.referenceFileIds)
            candidates.push({ source: { kind: 'request', taskId: request.data.taskId, requestId: request.id, fileVersionId }, metadata: blankEvidenceMetadata(), label: `요청 참고 자료 v${request.data.sequence}` });
    for (const submission of s.list('submission', contextId)) {
        for (const answer of submission.data.answers)
            for (const fileVersionId of answerFiles([answerDTO(answer)]))
                candidates.push({ source: { kind: 'submission', taskId: submission.data.taskId, requestId: submission.data.requestId, submissionId: submission.id, requirementKey: answer.requirementKey, productId: answer.productId, fileVersionId }, metadata: blankEvidenceMetadata(), label: `실제 제출 v${submission.data.sequence} · ${answer.requirementKey}` });
        for (const artifact of submission.data.artifacts)
            candidates.push({ source: { kind: 'submission', taskId: submission.data.taskId, requestId: submission.data.requestId, submissionId: submission.id, requirementKey: artifact.answer?.requirementKey ?? null, productId: artifact.answer?.productId ?? null, fileVersionId: artifact.fileVersionId }, metadata: blankEvidenceMetadata(), label: `실제 제출 v${submission.data.sequence} · ${artifact.role}` });
        for (const link of submission.data.links)
            if (link.fixedReference?.kind === 'file')
                candidates.push({ source: { kind: 'submission', taskId: submission.data.taskId, requestId: submission.data.requestId, submissionId: submission.id, requirementKey: null, productId: null, fileVersionId: link.fixedReference.fileVersionId }, metadata: blankEvidenceMetadata(), label: `실제 제출 v${submission.data.sequence} · 고정 근거` });
    }
    return candidates.flatMap(c => { try {
        const file = resolveSource(s, p, contextId, c.source, clock);
        return [{ source: sourceDTO(c.source), metadata: c.metadata, label: c.label, file: { ...fileMetadata(file), ...fileUrls(file, sourceReference(file)), uploaderLabel: userLabel(s, p, contextId, file.data.uploaderId), uploadedAt: file.createdAt } }];
    }
    catch {
        return [];
    } });
}
