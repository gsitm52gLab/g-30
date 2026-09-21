import { describe, expect, it } from 'vitest';
import { AuthError } from '@/server/auth/errors';
import { parseReviewTarget, parseSaveOpinion, parseSaveBatchDraft, assertPublishableDraft, parsePublishBatch, parseReflectItems, parseResolveItems, parseRecordReview, correctionLimits } from '@/domain/corrections/validate';
import type { ReviewTarget, CorrectionItemDraft, BatchDraftInput, RecordReviewCommand } from '@/domain/corrections/types';
const target = (): ReviewTarget => ({ taskId: 'task-1', submissionId: 'submission-1', requestId: 'request-1', submissionContentHash: 'a'.repeat(64), answer: { requirementKey: 'copy', productId: null }, fileVersionIds: ['file-1'], productUseIds: ['use-1'], location: { page: '2', locator: '하단 문구' } });
const item = (key = 'change-1'): CorrectionItemDraft => ({ key, target: target(), internalOpinionVersionIds: ['opinion-version-1'], publicSource: '기관 검토 의견', change: '지정 문구 수정', reason: '누락 표시 보완', publicDescription: '공개한 수정 설명', priority: 'normal', issue: 'correction' });
const draft = (): BatchDraftInput => ({ title: '1차 수정', summary: '합성 공개 안내', items: [item()], mode: 'normal', pendingScopes: [], previousBatchVersionId: null });
const save = () => ({ taskId: 'task-1', draftId: null, expectedRevision: 0, idempotencyKey: 'intent-1', draft: draft() });
const review = (): RecordReviewCommand => ({ taskId: 'task-1', idempotencyKey: 'review-1', target: target(), source: { kind: 'external_opinion', agency: '합성 기관', reviewer: '합성 검토자', source: '합성 메일 1' }, scope: { medium: 'POP', language: 'ja', usePlace: '매장 A', productIds: ['product-1'] }, receivedOn: '2026-09-21', result: 'changes_requested', rationale: '이 버전과 사용 범위에 대한 의견', evidenceFileVersionIds: ['file-1'], previousReviewId: 'review-old' });
function rejects(action: () => unknown) {
    try { action(); expect.fail('expected controlled validation failure'); }
    catch (error) { expect(error).toBeInstanceOf(AuthError); expect(error).toMatchObject({ code: 'VALIDATION', status: 422 }); }
}
describe('G10 exact correction/review input boundary (no auth/storage execution)', () => {
    it('keeps exact historical target identity, common answer null and no current-product recapture fields', () => {
        const input = target(), result = parseReviewTarget(input);
        expect(result).toEqual(input);
        result.fileVersionIds.push('another');
        expect(input.fileVersionIds).toEqual(['file-1']);
        rejects(() => parseReviewTarget({ ...input, expectedCommonRevision: 7 }));
        rejects(() => parseReviewTarget({ ...input, productUseIds: ['use-1', 'use-1'] }));
        rejects(() => parseReviewTarget({ ...input, answer: { requirementKey: 'copy', productId: '' } }));
        rejects(() => parseReviewTarget({ ...input, submissionContentHash: { private: 'marker' } }));
        rejects(() => parseReviewTarget({ ...input, submissionContentHash: 'a'.repeat(63) }));
    });
    it('stores incomplete draft text but refuses empty publication without changing the draft', () => {
        const command = save(); command.draft.title = ''; command.draft.items = [];
        const parsed = parseSaveBatchDraft(command);
        expect(parsed.draft).toEqual(command.draft);
        rejects(() => assertPublishableDraft(parsed.draft));
        const complete = draft(), before = structuredClone(complete);
        expect(() => assertPublishableDraft(complete)).not.toThrow();
        expect(complete).toEqual(before);
        complete.items[0].publicDescription = ' ';
        rejects(() => assertPublishableDraft(complete));
    });
    it('keeps internal original text separate and never accepts forged actor/publication/state fields', () => {
        const input = { taskId: 'task-1', opinionId: null, expectedRevision: 0, idempotencyKey: 'save-source', opinion: { target: target(), source: { kind: 'internal_review', reviewer: '담당', source: '내부 검토' }, originalText: '  비공개 원문\n 그대로  ', internalFileVersionIds: ['private-file'], receivedOn: null, conflictingOpinionVersionIds: [] } };
        const parsed = parseSaveOpinion(input);
        expect(parsed.opinion.originalText).toBe(input.opinion.originalText);
        expect(JSON.stringify(parseSaveBatchDraft(save()))).not.toContain('비공개 원문');
        for (const extra of [{ recordedBy: 'admin' }, { publishedAt: 'now' }, { resolved: true }]) rejects(() => parseSaveOpinion({ ...input, ...extra }));
        rejects(() => parseSaveOpinion({ ...input, opinion: { ...input.opinion, source: { ...input.opinion.source, agency: 'wrong kind' } } }));
        rejects(() => parseSaveBatchDraft({ ...save(), draft: { ...draft(), items: [{ ...item(), originalText: 'leak' }] } }));
    });
    it('requires exact nonnegative safe CAS and idempotency, not numeric strings or inferred new/edit intent', () => {
        for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1']) rejects(() => parseSaveBatchDraft({ ...save(), expectedRevision: value }));
        rejects(() => parseSaveBatchDraft({ ...save(), draftId: 'draft-1', expectedRevision: 0 }));
        rejects(() => parseSaveBatchDraft({ ...save(), expectedRevision: 1 }));
        rejects(() => parseSaveBatchDraft({ ...save(), idempotencyKey: ' ' }));
        rejects(() => parsePublishBatch({ taskId: 'task-1', draftId: 'draft-1', expectedRevision: 0, idempotencyKey: 'publish' }));
        expect(parsePublishBatch({ taskId: 'task-1', draftId: 'draft-1', expectedRevision: 3, idempotencyKey: 'publish' })).toMatchObject({ expectedRevision: 3 });
    });
    it('bounds arrays and text at actual accepted edges without mutating source inputs', () => {
        const command = save(); command.draft.title = '가'.repeat(correctionLimits.title); command.draft.items = Array.from({ length: correctionLimits.items }, (_, i) => item(`i-${i}`));
        expect(parseSaveBatchDraft(command).draft.items).toHaveLength(correctionLimits.items);
        rejects(() => parseSaveBatchDraft({ ...command, draft: { ...command.draft, title: command.draft.title + '가' } }));
        rejects(() => parseSaveBatchDraft({ ...command, draft: { ...command.draft, items: [...command.draft.items, item('overflow')] } }));
        rejects(() => parseSaveBatchDraft({ ...save(), draft: { ...draft(), items: [item(), item()] } }));
        rejects(() => parseReviewTarget({ ...target(), location: { page: null, locator: 'x'.repeat(correctionLimits.locator + 1) } }));
        rejects(() => parseSaveBatchDraft({ ...save(), draft: { ...draft(), items: [{ ...item(), reason: { marker: 'nested' } }] } }));
    });
    it('represents urgent partial scope, late follow-up, conflict sources and wrong file explicitly', () => {
        const d = draft(); d.mode = 'urgent_partial';
        rejects(() => assertPublishableDraft(d));
        d.pendingScopes = [{ agency: '기관 B', scope: '뒷면 표시', expectedOn: '2028-02-29' }];
        d.previousBatchVersionId = 'batch-v1'; d.items[0].issue = 'conflicting_opinions';
        rejects(() => assertPublishableDraft(d));
        d.items[0].internalOpinionVersionIds.push('opinion-version-2');
        expect(() => assertPublishableDraft(d)).not.toThrow();
        d.items[0].issue = 'wrong_file';
        expect(parseSaveBatchDraft({ ...save(), draft: d }).draft).toMatchObject({ previousBatchVersionId: 'batch-v1', items: [{ issue: 'wrong_file' }] });
        d.pendingScopes[0].expectedOn = '2026-02-29';
        rejects(() => parseSaveBatchDraft({ ...save(), draft: d }));
    });
    it('reflection chooses explicit items and later exact submission; it cannot claim GSG resolution', () => {
        const v2 = { ...target(), submissionId: 'submission-2', submissionContentHash: 'b'.repeat(64), productUseIds: ['use-2'] };
        const c = { taskId: 'task-1', batchVersionId: 'batch-1', idempotencyKey: 'reflect', items: [{ itemKey: 'change-1', expectedItemRevision: 0, target: v2, note: '' }] };
        expect(parseReflectItems(c).items).toEqual(c.items);
        rejects(() => parseReflectItems({ ...c, items: [] }));
        rejects(() => parseReflectItems({ ...c, items: [c.items[0], c.items[0]] }));
        rejects(() => parseReflectItems({ ...c, items: [{ ...c.items[0], resolved: true }] }));
        rejects(() => parseReflectItems({ ...c, items: [{ ...c.items[0], target: { ...v2, taskId: 'other-task' } }] }));
        // Existing/later sequence and file/use membership require real server records, not a guessed validator.
        expect(parseReflectItems({ ...c, items: [{ ...c.items[0], target: target() }] }).items[0].target.submissionId).toBe('submission-1');
    });
    it('GSG resolution refers to a specific reflection and preserves wrong-file follow-up reason', () => {
        const c = { taskId: 'task-1', batchVersionId: 'batch-1', idempotencyKey: 'resolve', items: [{ itemKey: 'change-1', expectedItemRevision: 2, reflectionId: 'reflection-2', decision: 'needs_confirmation', reason: '잘못된 파일 확인' }] };
        expect(parseResolveItems(c).items[0]).toMatchObject({ reflectionId: 'reflection-2', decision: 'needs_confirmation' });
        rejects(() => parseResolveItems({ ...c, items: [{ ...c.items[0], reason: '' }] }));
        rejects(() => parseResolveItems({ ...c, items: [{ ...c.items[0], reflectionId: null }] }));
        rejects(() => parseResolveItems({ ...c, items: [{ ...c.items[0], decision: 'approved_all' }] }));
        rejects(() => parseResolveItems({ ...c, actorRole: 'gsg' }));
    });
    it('review fixes scope/date and previous reference while refusing approval inheritance controls', () => {
        expect(parseRecordReview(review())).toEqual(review());
        for (const invalid of ['2026-02-29', '2026-09-21T00:00:00Z', '', '2026-13-01']) rejects(() => parseRecordReview({ ...review(), receivedOn: invalid }));
        rejects(() => parseRecordReview({ ...review(), scope: { ...review().scope, language: '' } }));
        rejects(() => parseRecordReview({ ...review(), inheritApproval: true }));
        rejects(() => parseRecordReview({ ...review(), result: 'legally_approved' }));
        rejects(() => parseRecordReview({ ...review(), target: { ...target(), taskId: 'foreign' } }));
        const ai = { ...review(), source: { kind: 'ai_candidate', runId: 'run-exact', findingId: 'finding-exact', source: '정확한 후보 위치' }, result: 'opinion_only' };
        expect(parseRecordReview(ai).source).toEqual(ai.source);
        rejects(() => parseRecordReview({ ...ai, source: { ...ai.source, findingId: '' } }));
    });
});
