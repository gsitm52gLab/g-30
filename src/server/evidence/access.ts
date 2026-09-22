import { asyncFlatMap } from "@/domain/async-collections";
import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import type { EvidenceSource } from '@/domain/evidence/types';
import { answerFiles } from '@/domain/submissions/files';
import { answerDTO } from '@/server/submissions/projection';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import type { ResourceScope } from '@/server/policy/types';
import { canReferenceFile } from '@/server/files/access';
import { productContextScope, resolveProduct } from '@/server/products/access';
export function evidenceScope(contextId: string, id = 'evidence', visibility: 'public' | 'internal' = 'public'): ResourceScope { return { kind: 'evidence', contextId, id, visibility }; }
export async function resolveSource(s: UnitOfWork, p: Principal, contextId: string, source: EvidenceSource, clock: Clock) {
    const file = (await s.get('fileVersion', source.fileVersionId));
    if (!file || file.contextId !== contextId)
        unavailable();
    if (source.kind === 'product_binding') {
        const r = (await resolveProduct(s, p, contextId, source.productId, clock)), version = (await s.get('contextProductVersion', source.contextVersionId));
        if (r.relation.id !== source.contextProductId || !version || version.contextId !== contextId || version.data.contextProductId !== r.relation.id || !version.data.files.some(b => b.id === source.bindingId && b.fileVersionId === file.id))
            unavailable();
        (await canReferenceFile(s, p, file, productContextScope(contextId, r.product.id), clock));
    }
    else {
        const task = (await s.get('task', source.taskId)), request = (await s.get('requestVersion', source.requestId));
        if (!task || task.contextId !== contextId || task.data.visibility !== 'public' || !request || request.contextId !== contextId || request.data.taskId !== task.id)
            unavailable();
        (await authorize(s, p, 'task.read', taskScope(task), clock));
        if (source.kind === 'request') {
            if (!request.data.content.referenceFileIds.includes(file.id))
                unavailable();
        }
        else {
            const submission = (await s.get('submission', source.submissionId));
            if (!submission || submission.contextId !== contextId || submission.data.taskId !== task.id || submission.data.requestId !== request.id || !submission.data.fileVersionIds.includes(file.id))
                unavailable();
            const included = source.requirementKey === null
                ? submission.data.artifacts.some(a => a.fileVersionId === file.id && a.answer === null) || submission.data.links.some(l => l.fixedReference?.kind === 'file' && l.fixedReference.fileVersionId === file.id)
                : submission.data.answers.some(a => a.requirementKey === source.requirementKey && a.productId === source.productId && answerFiles([answerDTO(a)]).includes(file.id)) || submission.data.artifacts.some(a => a.fileVersionId === file.id && a.answer?.requirementKey === source.requirementKey && a.answer.productId === source.productId);
            if (!included)
                unavailable();
        }
        (await canReferenceFile(s, p, file, taskScope(task), clock));
    }
    return file;
}
export async function resolveEvidenceVersion(s: UnitOfWork, p: Principal, versionId: string, clock: Clock) {
    const version = (await s.get('evidenceVersion', versionId));
    if (!version?.contextId)
        unavailable();
    (await authorize(s, p, 'evidence.read', evidenceScope(version.contextId, version.data.evidenceId), clock));
    const file = (await resolveSource(s, p, version.contextId, version.data.source, clock));
    (await authorize(s, p, 'evidence.read', evidenceScope(version.contextId, version.data.evidenceId, file.data.visibility), clock));
    return { version, file };
}
export async function resolveLink(s: UnitOfWork, p: Principal, linkId: string, clock: Clock, edit = false) {
    const link = (await s.get('evidenceLink', linkId));
    if (!link?.contextId)
        unavailable();
    const product = (await resolveProduct(s, p, link.contextId, link.data.productId, clock, edit));
    if (product.relation.id !== link.data.contextProductId)
        unavailable();
    const { version, file } = (await resolveEvidenceVersion(s, p, link.data.evidenceVersionId, clock));
    if (version.contextId !== link.contextId)
        unavailable();
    (await canReferenceFile(s, p, file, productContextScope(link.contextId, link.data.productId), clock));
    return { link, version, file, product };
}
export async function visibleLinks(s: UnitOfWork, p: Principal, version: StoredRecord<'evidenceVersion'>, clock: Clock) {
    return (await asyncFlatMap((await s.list('evidenceLink', version.contextId!)).filter(l => l.data.evidenceVersionId === version.id), async (l) => {
        try {
            return [(await resolveLink(s, p, l.id, clock))];
        }
        catch {
            return [];
        }
    }));
}
