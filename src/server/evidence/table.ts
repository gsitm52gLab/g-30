import type { Clock, UnitOfWork } from '@/domain/records';
import { assessmentStatuses, type CellStatus, type MaterialCounts } from '@/domain/evidence/types';
import type { RequirementEvaluation } from '@/domain/submissions/types';
import { answerFiles } from '@/domain/submissions/files';
import { safeEvaluation, answerDTO } from '@/server/submissions/projection';
import type { Principal } from '@/server/auth/service';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { resolveProduct, visibleProductRelations } from '@/server/products/access';
import { evidenceScope, resolveLink } from './access';
const text = (v: unknown) => typeof v === 'string' ? v : '';
export interface MaterialCell {
    columnId: string;
    taskId: string;
    requestId: string;
    requirementKey: string;
    answerProductId: string | null;
    status: CellStatus;
    required: boolean;
    applicable: boolean;
    canonicalStatus: RequirementEvaluation['status'];
    submissionId: string | null;
    humanReviewPending: boolean;
    issues: {
        code: string;
        message: string;
    }[];
    warnings: string[];
    evidenceLinks: {
        linkId: string;
        versionId: string;
        status: string;
        fileVersionId: string;
    }[];
    requestUrl: string;
    submissionUrl: string | null;
}
function counts(cells: MaterialCell[]): MaterialCounts {
    return { connected: true, requested: cells.filter(c => c.applicable).length,
        missing: cells.filter(c => c.applicable && (c.status === 'correction_needed' || c.canonicalStatus === 'invalid' || c.canonicalStatus === 'needs_reconfirmation' || c.required && c.status === 'missing')).length,
        unconfirmed: cells.filter(c => c.applicable && c.submissionId !== null && ['submitted', 'content_confirmation'].includes(c.status)).length };
}
export function materialTable(s: UnitOfWork, p: Principal, contextId: string, clock: Clock, history = false) {
    authorize(s, p, 'evidence.read', evidenceScope(contextId), clock);
    const products = visibleProductRelations(s, p, clock, contextId).map(cp => resolveProduct(s, p, contextId, cp.data.productId, clock));
    const tasks = s.list('task', contextId).filter(t => t.data.visibility === 'public' && t.data.currentRequestId && decide(s, p, 'task.read', taskScope(t), clock).allowed && (history ? ['completed', 'cancelled'].includes(t.data.status) : !['completed', 'cancelled'].includes(t.data.status)));
    const columns = tasks.flatMap(task => {
        const request = s.get('requestVersion', task.data.currentRequestId!);
        if (!request || request.data.taskId !== task.id)
            return [];
        const latest = s.list('submission', contextId).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence)[0] ?? null;
        const previous = latest ? s.get('requestVersion', latest.data.requestId) : null, evaluation = safeEvaluation(request.data.content, latest?.data.answers ?? [], previous?.data.content ?? request.data.content);
        return evaluation.items.map(item => ({ task, request, latest, item }));
    });
    const columnDTO = [...new Map(columns.map(({ task, request, item }) => [JSON.stringify([task.id, request.id, item.requirementKey]), { id: JSON.stringify([task.id, request.id, item.requirementKey]), taskId: task.id, taskTitle: text(task.data.title), taskStatus: task.data.status, requestId: request.id, requirementKey: item.requirementKey, label: item.label, type: item.type, documentBearing: ['file', 'link', 'physical_record'].includes(item.type), required: item.required }])).values()];
    const rows = products.map(r => {
        const cells: MaterialCell[] = columnDTO.map(column => {
            const candidates = columns.filter(c => c.task.id === column.taskId && c.item.requirementKey === column.requirementKey), match = candidates.find(c => c.task.data.productIds.includes(r.product.id) && (c.item.productId === null || c.item.productId === r.product.id));
            const example = candidates[0], item = match?.item, requestId = column.requestId, answerProductId = item?.productId ?? null, latest = match?.latest ?? null;
            const answer = latest?.data.answers.find(a => a.requirementKey === column.requirementKey && a.productId === answerProductId), fileIds = answer ? answerFiles([answerDTO(answer)]) : [];
            const evidenceLinks = s.list('evidenceLink', contextId).filter(l => l.data.active && l.data.productId === r.product.id).flatMap(l => {
                try {
                    const value = resolveLink(s, p, l.id, clock), source = value.version.data.source;
                    // The exact bytes must be present in the actual answer, never only in inventory.
                    if (!latest || !fileIds.includes(value.file.id))
                        return [];
                    if (source.kind === 'submission' && (source.submissionId !== latest.id || source.requestId !== latest.data.requestId || source.requirementKey !== column.requirementKey || source.productId !== answerProductId))
                        return [];
                    const assessment = l.data.currentAssessmentId ? s.get('evidenceAssessment', l.data.currentAssessmentId) : null;
                    return [{ linkId: l.id, versionId: value.version.id, status: assessment && assessmentStatuses.includes(assessment.data.status) ? assessment.data.status : 'pending', fileVersionId: value.file.id }];
                }
                catch {
                    return [];
                }
            });
            const applicable = !!item && item.status !== 'not_applicable', received = !!answer && !!item && ['received', 'prior_received'].includes(item.status);
            let status: CellStatus = !applicable ? 'not_applicable' : !received ? 'missing' : item!.humanReviewPending ? 'content_confirmation' : 'submitted';
            if (applicable && received && evidenceLinks.some(l => l.status === 'correction_needed'))
                status = 'correction_needed';
            else if (applicable && received && !item!.humanReviewPending && fileIds.length > 0 && fileIds.every(id => evidenceLinks.some(l => l.fileVersionId === id && l.status === 'application_confirmed')))
                status = 'application_confirmed';
            else if (applicable && item && ['invalid', 'needs_reconfirmation'].includes(item.status))
                status = 'content_confirmation';
            const query = new URLSearchParams({ context: contextId }), requestUrl = `/tasks/${encodeURIComponent(column.taskId)}?${query}`;
            const submissionQuery = new URLSearchParams({ context: contextId, requestId: latest?.data.requestId ?? requestId, submissionId: latest?.id ?? '', requirementKey: column.requirementKey, productId: answerProductId ?? '' });
            return { columnId: column.id, taskId: column.taskId, requestId, requirementKey: column.requirementKey, answerProductId, status, required: item?.required ?? example.item.required, applicable, canonicalStatus: item?.status ?? 'not_applicable', submissionId: answer ? latest?.id ?? null : null, humanReviewPending: item?.humanReviewPending ?? false, issues: item?.issues ?? [], warnings: item?.warnings ?? [], evidenceLinks, requestUrl, submissionUrl: answer && latest ? `/tasks/${encodeURIComponent(column.taskId)}?${submissionQuery}` : null };
        });
        return { productId: r.product.id, contextProductId: r.relation.id, name: text(r.common.data.common.name), code: text(r.common.data.common.code), cells, counts: counts(cells) };
    });
    return { contextId, history, columns: columnDTO, rows, counts: counts(rows.flatMap(r => r.cells)), notice: '업로드·자료 등록과 실제 제출은 별개입니다. 증빙의 해당 없음은 공개 요청의 필수 항목을 면제하지 않습니다.' };
}
export function productMaterialCounts(s: UnitOfWork, p: Principal, contextId: string, productId: string, clock: Clock): MaterialCounts { return materialTable(s, p, contextId, clock).rows.find(r => r.productId === productId)?.counts ?? { connected: true, requested: 0, missing: 0, unconfirmed: 0 }; }
export type MaterialTable = ReturnType<typeof materialTable>;
