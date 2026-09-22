import { asyncFilter, asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { readCompletionSummary } from '@/server/completion/summary';
import { readSubmissionReview } from '@/server/corrections/summary';
import { campaignRequestSource, materialProductIds } from '@/server/tasks/campaign-request';
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
export const latestSubmission = async (s: UnitOfWork, task: StoredRecord<'task'>) => (await s.list('submission', task.contextId!)).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence)[0] ?? null;
export const sharedDraft = async (s: UnitOfWork, task: StoredRecord<'task'>) => (await s.list('submissionDraft', task.contextId!)).find(v => v.data.taskId === task.id) ?? null;
export async function snapshotDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'submission'>, clock: Clock) {
    const { task } = (await submissionTask(s, p, row.data.taskId, clock)), request = (await s.get('requestVersion', row.data.requestId));
    if (!request)
        unavailable();
    const d = row.data;
    const files = (await asyncMap(d.fileVersionIds, async (id) => (await fileDTO(s, p, task, id, clock))));
    return { id: row.id, taskId: task.id, contextId: task.contextId!, requestId: request.id,
        request: { id: request.id, sequence: request.data.sequence, source: (await campaignRequestSource(s, request)), content: projectedRequest(request.data.content, false, (await asyncFilter(request.data.content.referenceFileIds, async (id) => { const file = (await s.get('fileVersion', id)); return !!file && file.data.visibility === 'public' && (await visibleFile(s, p, file, taskScope(task), clock)); }))) },
        sequence: d.sequence, previousId: d.previousId, mode: d.mode,
        content: contentDTO(d), answers: (await asyncMap(d.answers, async (a) => (await storedAnswerDTO(s, p, task.contextId!, a)))), files,
        products: (await asyncMap(d.productUseIds, async (id) => (await readProductUse(s, p, id, clock)))), providedBy: (await providerDTO(s, p, task.contextId!, d.providedBy)),
        recordedBy: d.recordedBy, recorderLabel: (await userLabel(s, p, task.contextId!, d.recordedBy)), submittedAt: d.submittedAt, contentHash: d.contentHash,
        evaluation: safeEvaluation(request.data.content, d.answers, request.data.content, false, (await campaignRequestSource(s, request))?.noMaterials === true), review: (await readSubmissionReview(s, p, task.id, row.id, clock)), completion: (await readCompletionSummary(s, p, task.id, clock)) };
}
export async function workspace(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const { task, request } = (await submissionTask(s, p, taskId, clock)), caps = (await capabilities(s, p, task, clock)), draft = (await sharedDraft(s, task)), latest = (await latestSubmission(s, task));
    const editable = caps.editDraft ? draft : null, previous = editable ? (await s.get('requestVersion', editable.data.baseRequestId)) : null;
    const currentContent = editable ? contentDTO(editable.data) : blankDraft();
    const currentFiles = editable ? (await asyncFlatMap(contentFiles(currentContent), async (id) => {
        try {
            return [(await fileDTO(s, p, task, id, clock))];
        }
        catch {
            return [];
        }
    })) : [];
    const products = (await asyncMap((await materialProductIds(s, task, request)), async (id) => {
        const detail = (await productDetail(s, p, (await resolveProduct(s, p, task.contextId!, id, clock)), clock));
        return { productId: id, commonRevision: detail.commonRevision, contextRevision: detail.contextRevision, common: detail.common, local: detail.local,
            bindings: detail.files.filter(b => b.file.visibility === 'public'), retail: detail.retail };
    }));
    const availableFiles = caps.editDraft ? (await asyncMap((await asyncFilter((await s.list('fileVersion', task.contextId!)), async (f) => f.data.visibility === 'public' && (await visibleFile(s, p, f, taskScope(task), clock)))), async (f) => ({ ...(await fileDTO(s, p, task, f.id, clock)), ...fileUrls(f, sourceReference(f)) }))) : [];
    return { taskId: task.id, contextId: task.contextId!, taskRevision: task.revision, userId: p.user.id, taskStatus: task.data.status,
        request: { id: request.id, sequence: request.data.sequence, source: (await campaignRequestSource(s, request)), content: projectedRequest(request.data.content, false, (await asyncFilter(request.data.content.referenceFileIds, async (id) => { const f = (await s.get("fileVersion", id)); return !!f && f.data.visibility === "public" && (await visibleFile(s, p, f, taskScope(task), clock)); }))) }, capabilities: caps,
        draft: editable ? { id: editable.id, revision: editable.revision, baseRequestId: editable.data.baseRequestId, baseSubmissionId: editable.data.baseSubmissionId, content: currentContent,
            answers: (await asyncMap(editable.data.answers, async (a) => (await storedAnswerDTO(s, p, task.contextId!, a)))), providedBy: (await providerDTO(s, p, task.contextId!, editable.data.providedBy)), lastEditedBy: editable.data.lastEditedBy, editorLabel: (await userLabel(s, p, task.contextId!, editable.data.lastEditedBy)), lastEditedAt: editable.data.lastEditedAt, files: currentFiles,
            unavailableFileIds: contentFiles(currentContent).filter(id => !currentFiles.some(f => f.id === id)), consumedBy: (await s.list('submission', task.contextId!)).find(v => v.data.draftId === editable.id && v.data.committedDraftRevision === editable.revision)?.id ?? null } : null,
        draftEvaluation: caps.editDraft ? safeEvaluation(request.data.content, currentContent.answers, previous?.data.content ?? request.data.content, false, (await campaignRequestSource(s, request))?.noMaterials === true) : null,
        submittedEvaluation: latest ? { sourceSubmissionId: latest.id, isCurrentRequest: latest.data.requestId === request.id, evaluation: safeEvaluation(request.data.content, latest.data.answers, (await s.get("requestVersion", latest.data.requestId))?.data.content ?? null, true, (await campaignRequestSource(s, request))?.noMaterials === true) } : null,
        requiresRebase: !!editable && editable.data.baseRequestId !== request.id,
        latest: latest ? (await snapshotDTO(s, p, latest, clock)) : null,
        history: (await asyncMap((await s.list('submission', task.contextId!)).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => ({ id: v.id, sequence: v.data.sequence, requestId: v.data.requestId, mode: v.data.mode, submittedAt: v.data.submittedAt, recorderLabel: (await userLabel(s, p, task.contextId!, v.data.recordedBy)) }))),
        priorFixture: !latest && (await s.list('priorSubmission', task.contextId!)).some(v => v.data.taskId === task.id) ? { present: true, label: '이전 답변 계약 예시 — 실제 제출 아님' } : null,
        availableFiles, products,
        providers: caps.proxy ? (await asyncFlatMap((await s.list('membership', task.contextId!)), async (m) => { const user = (await s.get('user', m.data.userId)); return user ? [{ userId: user.id, label: (await userLabel(s, p, task.contextId!, user.id)) }] : []; })) : [],
        connections: { review: true, completion: true, notificationDelivery: true } };
}
export async function rebasePreview(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const { task, request } = (await submissionTask(s, p, taskId, clock, true)), draft = (await sharedDraft(s, task)), old = draft ? (await s.get('requestVersion', draft.data.baseRequestId)) : null;
    return { taskId, currentRequestId: request.id, draftRevision: draft?.revision ?? 0, fromRequestId: draft?.data.baseRequestId ?? null,
        answers: (await asyncMap((draft?.data.answers ?? []), async (a) => { const q = request.data.content.requirements.find(q => q.key === a.requirementKey); return { requirementKey: a.requirementKey, productId: a.productId, compatible: !!q && compatibleRequirement(q, request.data.content, old?.data.content ?? null), answer: (await storedAnswerDTO(s, p, task.contextId!, a)) }; })) };
}
export type SubmissionWorkspace = Awaited<ReturnType<typeof workspace>>;
export type SubmissionSnapshot = Awaited<ReturnType<typeof snapshotDTO>>;
export type RebasePreview = Awaited<ReturnType<typeof rebasePreview>>;
