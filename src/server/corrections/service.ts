import { asyncMap } from "@/domain/async-collections";
import { createHash } from 'node:crypto';
import type { UnitOfWork, StoredRecord } from '@/domain/records';
import type { IdentityService, Principal } from '@/server/auth/service';
import type { BatchDraftInput } from '@/domain/corrections/types';
import { assertFindingSource } from '@/server/ai-review/connector';
import * as parse from '@/domain/corrections/validate';
import { object, str } from '@/domain/tasks/validate';
import { fail, unavailable } from '@/server/auth/errors';
import { newId, receipt, fresh, audit } from '@/server/products/store';
import { correctionTask } from './access';
import { exactTarget, internalFiles, laterTarget } from './targets';
import { publicContent, batchDTO, itemState, opinionDTO, reviewDTO } from './projection';
import { correctionWorkspace } from './read';
import * as safe from './stored';
export type CorrectionCommand = ({
    command: 'save_opinion';
} & ReturnType<typeof parse.parseSaveOpinion>) | ({
    command: 'save_draft';
} & ReturnType<typeof parse.parseSaveBatchDraft>) | ({
    command: 'publish';
} & ReturnType<typeof parse.parsePublishBatch>) | ({
    command: 'reflect';
} & ReturnType<typeof parse.parseReflectItems>) | ({
    command: 'resolve';
} & ReturnType<typeof parse.parseResolveItems>) | ({
    command: 'record_review';
} & ReturnType<typeof parse.parseRecordReview>);
export class CorrectionService {
    constructor(public identity: IdentityService, private fault?: (stage: string) => void) { }
    get clock() { return this.identity.clock; }
    private async batch(s: UnitOfWork, p: Principal, id: string, taskId: string) { const b = (await s.get('correctionBatch', id)); if (!b || b.data.taskId !== taskId)
        unavailable(); (await correctionTask(s, p, taskId, this.clock)); return b; }
    private async opinions(s: UnitOfWork, p: Principal, taskId: string, ids: string[]) { return (await asyncMap(ids, async (id) => { const row = (await s.get('correctionOpinionVersion', id)); if (!row || row.data.target.taskId !== taskId)
        unavailable(); return (await opinionDTO(s, p, row, this.clock)); })); }
    private async checkDraft(s: UnitOfWork, p: Principal, taskId: string, d: BatchDraftInput) {
        if (d.previousBatchVersionId)
            (await this.batch(s, p, d.previousBatchVersionId, taskId));
        for (const item of d.items) {
            (await exactTarget(s, p, item.target, this.clock));
            const opinions = (await this.opinions(s, p, taskId, item.internalOpinionVersionIds));
            if (opinions.some(o => o.target.submissionId !== item.target.submissionId))
                fail('TARGET_MISMATCH', 422, '의견과 수정항목의 정확한 제출 버전이 달라졌습니다.');
        }
    }
    private async event(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, kind: string, id: string) { (await s.create('domainEvent', { id: newId(), contextId: task.contextId, data: { eventType: kind, targetId: task.id, sourceVersionId: id, actorId: p.user.id, at: this.clock() } })); }
    async workspace(token: string | undefined, taskId: string) { return this.identity.repo.transaction(async (s) => (await correctionWorkspace(s, (await this.identity.principal(s, token)), taskId, this.clock))); }
    async detail(token: string | undefined, batchId: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), b = (await s.get('correctionBatch', batchId)); if (!b)
        unavailable(); (await correctionTask(s, p, b.data.taskId, this.clock)); return (await batchDTO(s, p, b, this.clock)); }); }
    async preview(token: string | undefined, draftId: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), d = (await s.get('correctionDraft', draftId)); if (!d)
        unavailable(); (await correctionTask(s, p, d.data.taskId, this.clock, 'manage')); const content = safe.draft(d.data.draft); (await this.checkDraft(s, p, d.data.taskId, content)); return publicContent(content); }); }
    async command(token: string | undefined, input: unknown) {
        const v = object(input, ['command', 'taskId', 'idempotencyKey', 'opinionId', 'expectedRevision', 'opinion', 'draftId', 'draft', 'batchVersionId', 'items', 'target', 'source', 'scope', 'receivedOn', 'result', 'rationale', 'evidenceFileVersionIds', 'previousReviewId']);
        const command = str(v.command, 30, true), { command: _command, ...body } = v;
        void _command;
        if (!['save_opinion', 'save_draft', 'publish', 'reflect', 'resolve', 'record_review'].includes(command))
            fail('VALIDATION', 422, '검토 동작을 확인해 주세요.');
        const parsed = command === 'save_opinion' ? parse.parseSaveOpinion(body) : command === 'save_draft' ? parse.parseSaveBatchDraft(body) : command === 'publish' ? parse.parsePublishBatch(body) : command === 'reflect' ? parse.parseReflectItems(body) : command === 'resolve' ? parse.parseResolveItems(body) : parse.parseRecordReview(body);
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), task = (await correctionTask(s, p, parsed.taskId, this.clock, command === 'reflect' ? 'reflect' : 'manage'));
            if (command === 'save_opinion') {
                const x = parse.parseSaveOpinion(body);
                (await assertFindingSource(s, p, x.opinion.source, x.opinion.target, this.clock));
                (await exactTarget(s, p, x.opinion.target, this.clock));
                (await internalFiles(s, p, task.id, x.opinion.internalFileVersionIds, this.clock));
                (await this.opinions(s, p, task.id, x.opinion.conflictingOpinionVersionIds));
                const old = x.opinionId ? (await s.get('correctionOpinion', x.opinionId)) : null;
                if (x.opinionId && (!old || old.data.taskId !== task.id))
                    unavailable();
                return (await receipt(s, p, task.contextId!, `correction.opinion:${task.id}`, x as unknown as Record<string, unknown>, async () => {
                    fresh(old, x.expectedRevision);
                    const root = old ?? (await s.create('correctionOpinion', { id: newId(), contextId: task.contextId, data: { taskId: task.id, currentVersionId: null } })), prev = root.data.currentVersionId ? (await s.get('correctionOpinionVersion', root.data.currentVersionId)) : null;
                    const row = (await s.create('correctionOpinionVersion', { id: newId(), contextId: task.contextId, data: { ...x.opinion, opinionId: root.id, sequence: prev ? safe.integer(prev.data.sequence, 1) + 1 : 1, previousVersionId: prev?.id ?? null, recordedBy: p.user.id, recordedAt: this.clock() } }));
                    (await s.update('correctionOpinion', root.id, root.revision, { taskId: task.id, currentVersionId: row.id }));
                    (await audit(s, p, this.clock, task.contextId!, 'correction.opinion_saved', root.id, { versionId: prev?.id ?? null }, { versionId: row.id }));
                    return { ids: [root.id, row.id] };
                }, () => this.fault?.('opinion')));
            }
            if (command === 'save_draft') {
                const x = parse.parseSaveBatchDraft(body);
                (await this.checkDraft(s, p, task.id, x.draft));
                const old = x.draftId ? (await s.get('correctionDraft', x.draftId)) : null;
                if (x.draftId && (!old || old.data.taskId !== task.id))
                    unavailable();
                return (await receipt(s, p, task.contextId!, `correction.draft:${task.id}`, x as unknown as Record<string, unknown>, async () => { fresh(old, x.expectedRevision); if (old?.data.publishedVersionId)
                    fail('PUBLISHED_IMMUTABLE', 409, '이미 공개된 묶음입니다. 후속 묶음으로 추가해 주세요.'); const d = old ? (await s.update('correctionDraft', old.id, old.revision, { ...old.data, draft: x.draft })) : (await s.create('correctionDraft', { id: newId(), contextId: task.contextId, data: { taskId: task.id, draft: x.draft, publishedVersionId: null, createdBy: p.user.id } })); (await audit(s, p, this.clock, task.contextId!, 'correction.draft_saved', d.id, { revision: old?.revision ?? 0 }, { revision: d.revision })); return { ids: [d.id] }; }, () => this.fault?.('draft')));
            }
            if (command === 'publish') {
                const x = parse.parsePublishBatch(body), d = (await s.get('correctionDraft', x.draftId));
                if (!d || d.data.taskId !== task.id)
                    unavailable();
                const content = safe.draft(d.data.draft);
                (await this.checkDraft(s, p, task.id, content));
                return (await receipt(s, p, task.contextId!, `correction.publish:${task.id}`, x as unknown as Record<string, unknown>, async () => { fresh(d, x.expectedRevision); if (d.data.publishedVersionId)
                    fail('PUBLISHED_IMMUTABLE', 409, '이미 공개된 묶음입니다. 후속 묶음으로 추가해 주세요.'); parse.assertPublishableDraft(content); const previous = (await s.list('correctionBatch', task.contextId!)).filter(b => b.data.taskId === task.id); if (previous.length && !content.previousBatchVersionId)
                    fail('FOLLOWUP_REQUIRED', 422, '이전 공개 묶음을 선택해 후속 의견으로 연결해 주세요.'); const pub = publicContent(content), row = (await s.create('correctionBatch', { id: newId(), contextId: task.contextId, data: { taskId: task.id, draftId: d.id, draftRevision: d.revision, sequence: Math.max(0, ...previous.map(b => safe.integer(b.data.sequence, 1))) + 1, ...pub, publishedBy: p.user.id, publishedAt: this.clock(), contentHash: createHash('sha256').update(JSON.stringify(pub)).digest('hex') } })); (await s.update('correctionDraft', d.id, d.revision, { ...d.data, publishedVersionId: row.id })); (await audit(s, p, this.clock, task.contextId!, 'correction.published', row.id, {}, {})); (await this.event(s, p, task, 'CORRECTION_BATCH_PUBLISHED', row.id)); return { ids: [row.id] }; }, () => this.fault?.('publish')));
            }
            if (command === 'reflect' || command === 'resolve') {
                const x = command === 'reflect' ? parse.parseReflectItems(body) : parse.parseResolveItems(body), b = (await this.batch(s, p, x.batchVersionId, task.id));
                (await batchDTO(s, p, b, this.clock));
                return (await receipt(s, p, task.contextId!, `correction.${command}:${task.id}`, x as unknown as Record<string, unknown>, async () => {
                    const ids: string[] = [];
                    for (const value of x.items) {
                        const item = publicContent(b.data).items.find(i => i.key === value.itemKey);
                        if (!item)
                            unavailable();
                        const previous = (await itemState(s, p, b, item.key, this.clock)), state = (await s.list('correctionItemState', task.contextId!)).find(r => r.data.batchVersionId === b.id && r.data.itemKey === item.key);
                        fresh(state ?? null, value.expectedItemRevision);
                        if (command === 'reflect' && 'target' in value) {
                            (await laterTarget(s, p, item.target, value.target, this.clock));
                            const r = (await s.create('correctionReflection', { id: newId(), contextId: task.contextId, data: { taskId: task.id, batchVersionId: b.id, itemKey: item.key, target: value.target, note: value.note, recordedBy: p.user.id, recordedAt: this.clock(), itemRevision: previous.revision + 1 } }));
                            const data = { taskId: task.id, batchVersionId: b.id, itemKey: item.key, reflectionId: r.id, resolutionId: null };
                            if (state)
                                (await s.update('correctionItemState', state.id, state.revision, data));
                            else
                                (await s.create('correctionItemState', { id: newId(), contextId: task.contextId, data }));
                            ids.push(r.id);
                            (await this.event(s, p, task, 'CORRECTION_ITEM_REFLECTED', r.id));
                        }
                        else if ('decision' in value) {
                            if (!state || value.reflectionId !== state.data.reflectionId)
                                fail('CONFLICT', 409, '현재 반영 제출을 다시 확인해 주세요.');
                            const r = (await s.create('correctionResolution', { id: newId(), contextId: task.contextId, data: { taskId: task.id, batchVersionId: b.id, itemKey: item.key, reflectionId: value.reflectionId, decision: value.decision, reason: value.reason, resolvedBy: p.user.id, resolvedAt: this.clock(), itemRevision: previous.revision + 1 } }));
                            (await s.update('correctionItemState', state.id, state.revision, { ...state.data, resolutionId: r.id }));
                            ids.push(r.id);
                            (await this.event(s, p, task, 'CORRECTION_ITEM_RESOLVED', r.id));
                        }
                    }
                    (await audit(s, p, this.clock, task.contextId!, `correction.${command}`, b.id, {}, { factIds: ids }));
                    return { ids };
                }, () => this.fault?.(command)));
            }
            const x = parse.parseRecordReview(body);
            (await assertFindingSource(s, p, x.source, x.target, this.clock));
            const target = (await exactTarget(s, p, x.target, this.clock));
            if (x.scope.productIds.some(id => !target.products.some(u => u.productId === id)))
                fail('TARGET_MISMATCH', 422, '선택한 제출의 실제 상품 사용본 범위로 검토해 주세요.');
            (await internalFiles(s, p, task.id, x.evidenceFileVersionIds.filter(id => !target.files.some(f => f.id === id)), this.clock));
            if (x.previousReviewId) {
                const old = (await s.get('correctionReview', x.previousReviewId));
                if (!old || old.data.taskId !== task.id)
                    unavailable();
                (await reviewDTO(s, p, old, this.clock));
            }
            return (await receipt(s, p, task.contextId!, `correction.review:${task.id}`, x as unknown as Record<string, unknown>, async () => { const { idempotencyKey: _key, ...data } = x; void _key; const r = (await s.create('correctionReview', { id: newId(), contextId: task.contextId, data: { ...data, recordedBy: p.user.id, recordedAt: this.clock(), previousReviewIsReferenceOnly: true } })); (await audit(s, p, this.clock, task.contextId!, 'correction.review_recorded', r.id, {}, {})); return { ids: [r.id] }; }, () => this.fault?.('review')));
        });
    }
}
export type CorrectionWorkspace = Awaited<ReturnType<CorrectionService['workspace']>>;
export type CorrectionBatch = Awaited<ReturnType<CorrectionService['detail']>>;
export type CorrectionPreview = Awaited<ReturnType<CorrectionService['preview']>>;
