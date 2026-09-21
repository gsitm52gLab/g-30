import { campaignRequestSource,materialProductIds } from '@/server/tasks/campaign-request';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { blankDraft } from '@/domain/submissions/types';
import { compatibleRequirement } from '@/domain/submissions/evaluate';
import { projectedRequest } from '@/server/tasks/projection';
import { fileUrls, sourceReference } from '@/server/files/service';
import { visibleFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { resolveProduct } from '@/server/products/access';
import { productDetail } from '@/server/products/read';
import { readProductUse } from '@/server/products/capture';
import { unavailable } from '@/server/auth/errors';
import { capabilities, submissionTask, userLabel } from './access';
import { safeEvaluation, contentDTO, contentFiles, fileDTO, providerDTO, storedAnswerDTO } from './projection';
export const latestSubmission = (s: UnitOfWork, task: StoredRecord<'task'>) => s.list('submission', task.contextId!).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence)[0] ?? null;
export const sharedDraft = (s: UnitOfWork, task: StoredRecord<'task'>) => s.list('submissionDraft', task.contextId!).find(v => v.data.taskId === task.id) ?? null;
export function snapshotDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'submission'>, clock: Clock) {
    const { task } = submissionTask(s, p, row.data.taskId, clock), request = s.get('requestVersion', row.data.requestId);
    if (!request)
        unavailable();
    const d = row.data;
    const files = d.fileVersionIds.map(id => fileDTO(s, p, task, id, clock));
    return { id: row.id, taskId: task.id, contextId: task.contextId!, requestId: request.id,
        request: { id: request.id, sequence: request.data.sequence, source: campaignRequestSource(s,request), content: projectedRequest(request.data.content, false, request.data.content.referenceFileIds.filter(id => { const file = s.get('fileVersion', id); return !!file && file.data.visibility === 'public' && visibleFile(s, p, file, taskScope(task), clock); })) },
        sequence: d.sequence, previousId: d.previousId, mode: d.mode,
        content: contentDTO(d), answers: d.answers.map(a => storedAnswerDTO(s, p, task.contextId!, a)), files,
        products: d.productUseIds.map(id => readProductUse(s, p, id, clock)), providedBy: providerDTO(s, p, task.contextId!, d.providedBy),
        recordedBy: d.recordedBy, recorderLabel: userLabel(s, p, task.contextId!, d.recordedBy), submittedAt: d.submittedAt, contentHash: d.contentHash,
        evaluation: safeEvaluation(request.data.content,d.answers,request.data.content,false,campaignRequestSource(s,request)?.noMaterials===true), review: { connected: false as const, status: 'pending' as const }, completion: { connected: false as const, status: 'not_completed' as const } };
}
export function workspace(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const { task, request } = submissionTask(s, p, taskId, clock), caps = capabilities(s, p, task, clock), draft = sharedDraft(s, task), latest = latestSubmission(s, task);
    const editable = caps.editDraft ? draft : null, previous = editable ? s.get('requestVersion', editable.data.baseRequestId) : null;
    const currentContent = editable ? contentDTO(editable.data) : blankDraft();
    const currentFiles = editable ? contentFiles(currentContent).flatMap(id => { try {
        return [fileDTO(s, p, task, id, clock)];
    }
    catch {
        return [];
    } }) : [];
    const products = materialProductIds(s,task,request).map(id => {
        const detail = productDetail(s, p, resolveProduct(s, p, task.contextId!, id, clock), clock);
        return { productId: id, commonRevision: detail.commonRevision, contextRevision: detail.contextRevision, common: detail.common, local: detail.local,
            bindings: detail.files.filter(b => b.file.visibility === 'public'), retail: detail.retail };
    });
    const availableFiles = caps.editDraft ? s.list('fileVersion', task.contextId!).filter(f => f.data.visibility === 'public' && visibleFile(s, p, f, taskScope(task), clock)).map(f => ({ ...fileDTO(s, p, task, f.id, clock), ...fileUrls(f, sourceReference(f)) })) : [];
    return { taskId: task.id, contextId: task.contextId!, taskRevision: task.revision, userId: p.user.id, taskStatus: task.data.status,
        request: { id: request.id, sequence: request.data.sequence, source: campaignRequestSource(s,request), content: projectedRequest(request.data.content, false, request.data.content.referenceFileIds.filter(id => { const f = s.get("fileVersion", id); return !!f && f.data.visibility === "public" && visibleFile(s, p, f, taskScope(task), clock); })) }, capabilities: caps,
        draft: editable ? { id: editable.id, revision: editable.revision, baseRequestId: editable.data.baseRequestId, baseSubmissionId: editable.data.baseSubmissionId, content: currentContent,
            answers: editable.data.answers.map(a => storedAnswerDTO(s, p, task.contextId!, a)), providedBy: providerDTO(s, p, task.contextId!, editable.data.providedBy), lastEditedBy: editable.data.lastEditedBy, editorLabel: userLabel(s, p, task.contextId!, editable.data.lastEditedBy), lastEditedAt: editable.data.lastEditedAt, files: currentFiles,
            unavailableFileIds: contentFiles(currentContent).filter(id => !currentFiles.some(f => f.id === id)), consumedBy: s.list('submission', task.contextId!).find(v => v.data.draftId === editable.id && v.data.committedDraftRevision === editable.revision)?.id ?? null } : null,
        draftEvaluation: caps.editDraft ? safeEvaluation(request.data.content,currentContent.answers,previous?.data.content??request.data.content,false,campaignRequestSource(s,request)?.noMaterials===true) : null,
        submittedEvaluation: latest ? { sourceSubmissionId: latest.id, isCurrentRequest: latest.data.requestId === request.id, evaluation: safeEvaluation(request.data.content, latest.data.answers, s.get("requestVersion", latest.data.requestId)?.data.content ?? null,true,campaignRequestSource(s,request)?.noMaterials===true) } : null,
        requiresRebase: !!editable && editable.data.baseRequestId !== request.id,
        latest: latest ? snapshotDTO(s, p, latest, clock) : null,
        history: s.list('submission', task.contextId!).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence).map(v => ({ id: v.id, sequence: v.data.sequence, requestId: v.data.requestId, mode: v.data.mode, submittedAt: v.data.submittedAt, recorderLabel: userLabel(s, p, task.contextId!, v.data.recordedBy) })),
        priorFixture: !latest && s.list('priorSubmission', task.contextId!).some(v => v.data.taskId === task.id) ? { present: true, label: '이전 답변 계약 예시 — 실제 제출 아님' } : null,
        availableFiles, products,
        providers: caps.proxy ? s.list('membership', task.contextId!).flatMap(m => { const user = s.get('user', m.data.userId); return user ? [{ userId: user.id, label: userLabel(s, p, task.contextId!, user.id) }] : []; }) : [],
        connections: { review: false, completion: false, notificationDelivery: false } };
}
export function rebasePreview(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const { task, request } = submissionTask(s, p, taskId, clock, true), draft = sharedDraft(s, task), old = draft ? s.get('requestVersion', draft.data.baseRequestId) : null;
    return { taskId, currentRequestId: request.id, draftRevision: draft?.revision ?? 0, fromRequestId: draft?.data.baseRequestId ?? null,
        answers: (draft?.data.answers ?? []).map(a => { const q = request.data.content.requirements.find(q => q.key === a.requirementKey); return { requirementKey: a.requirementKey, productId: a.productId, compatible: !!q && compatibleRequirement(q, request.data.content, old?.data.content ?? null), answer: storedAnswerDTO(s, p, task.contextId!, a) }; }) };
}
export type SubmissionWorkspace = ReturnType<typeof workspace>;
export type SubmissionSnapshot = ReturnType<typeof snapshotDTO>;
export type RebasePreview = ReturnType<typeof rebasePreview>;
