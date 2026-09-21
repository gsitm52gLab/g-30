import { createHash } from 'node:crypto';
import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { DraftContent, StoredAnswer, SubmissionDraftData } from '@/domain/submissions/types';
import { answerKey } from '@/domain/submissions/types';
import { parseDraft, normalizeAnswer, validLink } from '@/domain/submissions/validate';
import { ids, object, enumValue, list } from '@/domain/tasks/validate';
import type { IdentityService, Principal } from '@/server/auth/service';
import { revision } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { receipt, newId, audit } from '@/server/products/store';
import { captureProductUse } from '@/server/products/capture';
import { resolveProduct } from '@/server/products/access';
import { submissionTask, assertRequest, assertDraft, provider, capabilities } from './access';
import { safeEvaluation, contentDTO, answerDTO, contentFiles, publicFile } from './projection';
import { workspace, snapshotDTO, rebasePreview, sharedDraft, latestSubmission } from './read';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class SubmissionService {
    constructor(public identity: IdentityService, private fault?: (stage: string) => void) { }
    get clock() { return this.identity.clock; }
    async workspace(token: string | undefined, taskId: string) { return this.identity.repo.transaction(s => workspace(s, this.identity.principal(s, token), taskId, this.clock)); }
    async snapshot(token: string | undefined, id: string) { return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), row = s.get('submission', id); if (!row)
        unavailable(); return snapshotDTO(s, p, row, this.clock); }); }
    async evaluate(token: string | undefined, taskId: string, input: Record<string, unknown>) {
        object(input, ['baseRequestId', 'content']);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), { task, request } = this.editable(s, p, taskId);
            assertRequest(task, input.baseRequestId);
            const content = parseDraft(input.content, request.id, request.data.content, task.data.productIds);
            const fileIssues = contentFiles(content).flatMap(fileVersionId => { try {
                publicFile(s, p, task, fileVersionId, this.clock);
                return [];
            }
            catch {
                return [{ fileVersionId, code: 'UNAVAILABLE' as const }];
            } });
            const productIssues = content.productSelections.flatMap<{
                productId: string;
                code: "CHANGED" | "UNAVAILABLE";
            }>(selection => {
                try {
                    const r = resolveProduct(s, p, task.contextId!, selection.productId, this.clock);
                    return r.product.revision !== selection.expectedCommonRevision || r.relation.revision !== selection.expectedContextRevision ? [{ productId: selection.productId, code: 'CHANGED' as const }] : [];
                }
                catch {
                    return [{ productId: selection.productId, code: 'UNAVAILABLE' as const }];
                }
            });
            return { requestId: request.id, evaluation: safeEvaluation(request.data.content, content.answers), fileIssues, productIssues, missingProductIds: task.data.productIds.filter(id => !content.productSelections.some(v => v.productId === id)), invalidLinkIndexes: content.links.flatMap((link, index) => validLink(link) ? [] : [index]) };
        });
    }
    async rebasePreview(token: string | undefined, taskId: string) { return this.identity.repo.transaction(s => rebasePreview(s, this.identity.principal(s, token), taskId, this.clock)); }
    private editable(s: UnitOfWork, p: Principal, taskId: string) {
        const scope = submissionTask(s, p, taskId, this.clock, true);
        if (!capabilities(s, p, scope.task, this.clock).editDraft)
            fail('CONFLICT', 409, '완료된 업무의 답변은 변경할 수 없습니다.');
        return scope;
    }
    private saveRow(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, requestId: string, content: DraftContent, providedBy: SubmissionDraftData['providedBy'], old: StoredRecord<'submissionDraft'> | null, baseSubmissionId: string | null, carried?: StoredAnswer[]) {
        for (const id of contentFiles(content))
            publicFile(s, p, task, id, this.clock);
        const answers: StoredAnswer[] = content.answers.map(a => {
            const prior = (carried ?? old?.data.answers)?.find(v => answerKey(v) === answerKey(a));
            const unchanged = prior && (carried ? prior.type === a.type && hash(prior.input) === hash(a.input) : hash(answerDTO(prior)) === hash(a));
            return { ...a, provenance: unchanged ? prior.provenance : { providedBy, recordedBy: p.user.id, at: this.clock(), originSubmissionId: null } };
        });
        const data: SubmissionDraftData = { ...content, answers, taskId: task.id, baseRequestId: requestId, baseSubmissionId, providedBy, lastEditedBy: p.user.id, lastEditedAt: this.clock() };
        return old ? s.update('submissionDraft', old.id, old.revision, data) : s.create('submissionDraft', { id: newId(), contextId: task.contextId, data });
    }
    async draft(token: string | undefined, taskId: string, input: Record<string, unknown>) {
        object(input, ['command', 'baseRequestId', 'expectedDraftRevision', 'content', 'providedBy', 'idempotencyKey', 'targetRequestId', 'carryAnswers', 'sourceSubmissionId']);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), { task, request } = this.editable(s, p, taskId), old = sharedDraft(s, task);
            const command = enumValue(input.command, ['save', 'rebase_apply', 'copy_submission']);
            return receipt(s, p, task.contextId!, `submission.draft.${command}:${task.id}`, input, () => {
                assertDraft(old?.revision ?? 0, input.expectedDraftRevision);
                let data: DraftContent, baseSubmissionId = old?.data.baseSubmissionId ?? null;
                const providedBy = provider(s, p, task.contextId!, input.providedBy);
                if (command === 'save') {
                    assertRequest(task, input.baseRequestId);
                    if (old && old.data.baseRequestId !== request.id)
                        fail('REQUEST_CHANGED', 409, '요청 변경 내용을 먼저 비교하고 초안을 전환해 주세요.');
                    data = parseDraft(input.content, request.id, request.data.content, task.data.productIds);
                }
                else if (command === 'rebase_apply') {
                    assertRequest(task, input.targetRequestId);
                    if (!old || old.data.baseRequestId !== input.baseRequestId)
                        fail('DRAFT_CHANGED', 409, '초안 기준 요청을 다시 확인해 주세요.');
                    const preview = rebasePreview(s, p, task.id, this.clock), selected = list(input.carryAnswers, 400).map(v => { const a = object(v, ['requirementKey', 'productId']); return JSON.stringify([ids([a.requirementKey])[0], a.productId === null ? null : ids([a.productId])[0]]); });
                    if (new Set(selected).size !== selected.length || selected.some(key => !preview.answers.some(a => answerKey(a) === key && a.compatible)))
                        fail('VALIDATION', 422, '호환되는 이전 답변만 명시적으로 이어받을 수 있습니다.');
                    const prior = contentDTO(old.data), answers = prior.answers.filter(a => selected.includes(answerKey(a))).map(a => ({ ...a, requestId: request.id }));
                    data = parseDraft({ ...prior, answers, artifacts: prior.artifacts.filter(a => !a.answer || selected.includes(answerKey(a.answer))), productSelections: prior.productSelections.filter(v => task.data.productIds.includes(v.productId)) }, request.id, request.data.content, task.data.productIds);
                }
                else {
                    assertRequest(task, input.baseRequestId);
                    const source = s.get('submission', ids([input.sourceSubmissionId])[0]);
                    if (!source || source.data.taskId !== task.id || source.data.requestId !== request.id)
                        fail('REQUEST_CHANGED', 409, '현재 요청에 제출한 버전만 초안으로 복사할 수 있습니다. 이전 요청은 변경 비교를 이용해 주세요.');
                    snapshotDTO(s, p, source, this.clock);
                    data = contentDTO(source.data);
                    baseSubmissionId = source.id;
                }
                const carried = command === 'copy_submission' ? s.get('submission', input.sourceSubmissionId as string)!.data.answers : command === 'rebase_apply' ? old!.data.answers : undefined;
                const row = this.saveRow(s, p, task, request.id, data, providedBy, old, baseSubmissionId, carried);
                audit(s, p, this.clock, task.contextId!, 'submission.draft_saved', task.id, { draftRevision: old?.revision ?? 0 }, { draftId: row.id, requestId: request.id });
                this.fault?.('draft');
                return { ids: [row.id] };
            });
        });
    }
    async submit(token: string | undefined, taskId: string, input: Record<string, unknown>) {
        object(input, ['baseRequestId', 'expectedDraftRevision', 'expectedTaskRevision', 'mode', 'idempotencyKey']);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), { task, request } = submissionTask(s, p, taskId, this.clock, true), mode = enumValue(input.mode, ['partial', 'full']), draft = sharedDraft(s, task);
            return receipt(s, p, task.contextId!, `submission.submit:${task.id}`, input, () => {
                assertRequest(task, input.baseRequestId);
                if (!draft)
                    fail('DRAFT_REQUIRED', 409, '먼저 공유 초안을 저장해 주세요.');
                const used = s.list('submission', task.contextId!).find(v => v.data.draftId === draft.id && v.data.committedDraftRevision === input.expectedDraftRevision);
                if (used) {
                    if (used.data.mode !== mode || used.data.requestId !== request.id)
                        fail('CONFLICT', 409, '이미 제출한 초안입니다. 수정한 초안을 저장해 주세요.');
                    return { ids: [used.id] };
                }
                if (!capabilities(s, p, task, this.clock).submit)
                    fail('TASK_PAUSED', 409, '보류·취소·완료 상태에서는 제출할 수 없습니다. 저장된 초안은 유지됩니다.');
                assertDraft(draft.revision, input.expectedDraftRevision);
                if (task.revision !== revision(input.expectedTaskRevision))
                    fail('CONFLICT', 409, '업무가 변경되었습니다. 최신 상태를 확인해 주세요.');
                if (draft.data.baseRequestId !== request.id)
                    fail('REQUEST_CHANGED', 409, '초안을 현재 요청으로 전환해 주세요.');
                const content = parseDraft(contentDTO(draft.data), request.id, request.data.content, task.data.productIds);
                const evaluation = safeEvaluation(request.data.content, content.answers);
                if (evaluation.invalid || content.links.some(l => !validLink(l)))
                    fail('INVALID_ANSWERS', 422, '입력한 값의 형식과 링크 설명을 확인해 주세요. 빈 필수 항목은 부분 제출할 수 있습니다.');
                if (mode === 'full' && !evaluation.canSubmitFull)
                    fail('MISSING_REQUIRED', 422, '필수 항목을 채우거나 부분 제출을 선택해 주세요.');
                if (task.data.productIds.some(id => !content.productSelections.some(v => v.productId === id)))
                    fail('PRODUCT_SELECTION_REQUIRED', 422, '연결된 각 상품의 정확한 버전과 자료·소비자가 선택을 확인해 주세요.');
                const files = contentFiles(content).map(id => publicFile(s, p, task, id, this.clock)), previous = latestSubmission(s, task), submissionId = newId();
                const productUseIds = content.productSelections.map(selection => {
                    const r = resolveProduct(s, p, task.contextId!, selection.productId, this.clock);
                    for (const bid of selection.bindingIds) {
                        const binding = r.local.data.files.find(b => b.id === bid);
                        if (!binding)
                            unavailable();
                        publicFile(s, p, task, binding.fileVersionId, this.clock);
                    }
                    const use = captureProductUse(s, p, { ...selection, contextId: task.contextId!, ownerType: 'submission', ownerId: submissionId, taskId: task.id, requestId: request.id }, this.clock);
                    this.fault?.('product_capture');
                    return use.id;
                });
                const answers: StoredAnswer[] = content.answers.map(a => { const q = request.data.content.requirements.find(q => q.key === a.requirementKey)!; return { ...a, input: normalizeAnswer(q, a).input ?? a.input, provenance: draft.data.answers.find(v => answerKey(v) === answerKey(a))!.provenance } as StoredAnswer; });
                const exact = { ...content, answers, files: files.map(f => ({ fileVersionId: f.id, name: f.data.originalName, bytes: f.data.bytes, mime: f.data.mime, sha256: f.data.sha256, preview: f.data.preview, uploaderId: f.data.uploaderId, uploadedAt: f.createdAt })), productUseIds };
                s.create('submission', { id: submissionId, contextId: task.contextId, data: { ...exact, taskId: task.id, requestId: request.id, baseSubmissionId: draft.data.baseSubmissionId, providedBy: draft.data.providedBy, sequence: (previous?.data.sequence ?? 0) + 1, previousId: previous?.id ?? null, draftId: draft.id, committedDraftRevision: draft.revision, mode, fileVersionIds: files.map(f => f.id), evaluation, recordedBy: p.user.id, submittedAt: this.clock(), contentHash: hash(exact) } });
                s.update('task', task.id, task.revision, { ...task.data, status: mode === 'full' ? 'submitted' : 'partial', submissionProgress: { latestSubmissionId: submissionId, requestId: request.id, mode } });
                audit(s, p, this.clock, task.contextId!, 'submission.created', task.id, { submissionId: previous?.id ?? null }, { submissionId, requestId: request.id, mode });
                s.create('domainEvent', { id: newId(), contextId: task.contextId, data: { eventType: 'TASK_SUBMITTED', targetId: task.id, sourceVersionId: submissionId, actorId: p.user.id, at: this.clock() } });
                this.fault?.('submit');
                return { ids: [submissionId] };
            });
        });
    }
}
