import { describe, expect, it } from 'vitest';
import { AuthError } from '@/server/auth/errors';
import { inquiryId, inquiryLimits, parseCreateConversationDraft, parsePublishFirst, parseInquiryCommand, parseInquiryEventsQuery, parseInquiryListQuery } from '@/domain/inquiries/validate';
const content = () => ({ clientMessageId: 'client-message-1', body: '  답변 원문\n둘째 줄  ', fileVersionIds: ['file-1'] });
const create = () => ({ contextId: 'ctx-jp-a-luna', taskId: null, idempotencyKey: 'create-1' });
const first = () => ({ command: 'publish_first', expectedRevision: 1, title: '독립 질문', content: content(), idempotencyKey: 'first-1' });
const answer = () => ({ command: 'answer', questionId: 'question-1', expectedQuestionRevision: 1, content: content(), idempotencyKey: 'answer-1' });
const wait = () => ({ command: 'state', questionId: 'question-5', expectedQuestionRevision: 2, state: 'external_waiting', reason: '기관 회신 대기', externalWait: { counterparty: '합성 검토 담당', sentAt: '2026-09-21T09:30:00+09:00', responsibleUserId: 'user-gsg', nextCheckDate: '2026-09-25', timezone: 'Asia/Seoul', latestResult: '회신 대기' }, idempotencyKey: 'wait-1' });
function invalid(run: () => unknown) {
    let error: unknown;
    try { run(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'VALIDATION', status: 422 });
    expect((error as Error).message).not.toContain('PRIVATE_CANARY');
}
describe('G09 domain input boundary — no auth/storage/runtime claim', () => {
    it('SA35 creates only an independent draft without a task, assignee or premature first question', () => {
        const input = create(); expect(parseCreateConversationDraft(input)).toEqual(input);
        for (const extra of [{ title: 'old title' }, { question: content() }, { phase: 'active' }, { fileVersionIds: ['file-1'] }]) invalid(() => parseCreateConversationDraft({ ...input, ...extra }));
    });
    it('AC09-02 explicit first publish preserves original body and copies only selected file IDs', () => {
        const input = first(), parsed = parsePublishFirst(input);
        expect(parsed).toEqual(input); expect(parsed.content.body).toBe('  답변 원문\n둘째 줄  ');
        parsed.content.fileVersionIds.push('file-2'); expect(input.content.fileVersionIds).toEqual(['file-1']);
        expect(parseInquiryCommand(input)).toEqual(input);
    });
    it('AC09-02 first attachment-only publish requires title plus a nonempty supported payload', () => {
        const input = { ...first(), content: { ...content(), body: '' } };
        expect(parsePublishFirst(input)).toEqual(input);
        invalid(() => parsePublishFirst({ ...input, title: ' ' }));
        invalid(() => parsePublishFirst({ ...input, content: { ...input.content, fileVersionIds: [] } }));
        invalid(() => parsePublishFirst({ ...input, content: { ...input.content, body: ' ', fileVersionIds: [] } }));
        invalid(() => parsePublishFirst({ ...input, content: {} }));
    });
    it('A20 first publish requires positive private draft CAS and rejects forged phase/counters', () => {
        for (const expectedRevision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) invalid(() => parsePublishFirst({ ...first(), expectedRevision }));
        for (const extra of [{ phase: 'active' }, { activatedAt: '2026-09-22T00:00:00Z' }, { publicRevision: 1 }, { initiatorId: 'foreign' }, { questionId: 'foreign' }]) invalid(() => parseInquiryCommand({ ...first(), ...extra }));
        invalid(() => parsePublishFirst({ ...first(), command: 'question' }));
        invalid(() => parseInquiryCommand({ ...first(), command: 'question' }));
    });
    it('AC09-01 allows an explicit targeted answer with supported attachment-only content', () => {
        const a = answer(); a.content.body = ' ';
        expect(parseInquiryCommand(a)).toEqual(a);
        invalid(() => parseInquiryCommand({ ...a, content: { ...a.content, fileVersionIds: [] } }));
    });
    it('AC09-01 acknowledgement text is preserved without inferring answer or resolution', () => {
        const input = { command: 'message', kind: 'acknowledgement', questionId: 'question-5', content: { ...content(), body: '확인 중' }, idempotencyKey: 'ack-1' };
        expect(parseInquiryCommand(input)).toEqual(input);
        invalid(() => parseInquiryCommand({ ...input, kind: 'answer' }));
        invalid(() => parseInquiryCommand({ ...wait(), state: 'resolved', externalWait: null }));
    });
    it('AC09-01 requires a valid target and exact numeric question CAS for answers/supplements', () => {
        for (const questionId of [null, '', ' foreign ', '../q', { id: 'question-1' }]) invalid(() => parseInquiryCommand({ ...answer(), questionId }));
        for (const expectedQuestionRevision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, NaN]) invalid(() => parseInquiryCommand({ ...answer(), expectedQuestionRevision }));
        expect(parseInquiryCommand({ ...answer(), command: 'supplement' }).command).toBe('supplement');
    });
    it('A19 rejects client supplied identity, visibility, timestamps and arbitrary nested values', () => {
        for (const field of ['actorId', 'createdAt', 'visibility', 'initiatorId', 'publicRevision', 'participants']) invalid(() => parseCreateConversationDraft({ ...create(), [field]: 'PRIVATE_CANARY' }));
        invalid(() => parseInquiryCommand({ ...answer(), content: { ...content(), visibility: 'internal' } }));
        invalid(() => parseInquiryCommand({ ...answer(), content: { ...content(), body: { secret: 'PRIVATE_CANARY' } } }));
        invalid(() => parseCreateConversationDraft(Object.create(create())));
    });
    it('A19 keeps internal note as a distinct command and disallows public kind overrides', () => {
        const input = { command: 'internal_note', questionId: null, content: content(), idempotencyKey: 'internal-1' };
        expect(parseInquiryCommand(input)).toEqual(input);
        invalid(() => parseInquiryCommand({ ...input, kind: 'answer' }));
        invalid(() => parseInquiryCommand({ ...input, visibility: 'public' }));
    });
    it('A20 accepts exact text/count bounds and rejects over-limit or duplicate files without coercion', () => {
        const c = first(); c.title = '가'.repeat(inquiryLimits.title); c.content.body = '나'.repeat(inquiryLimits.body); c.content.fileVersionIds = Array.from({ length: 10 }, (_, i) => `file-${i}`);
        expect(parsePublishFirst(c)).toEqual(c);
        invalid(() => parsePublishFirst({ ...c, title: c.title + 'a' }));
        invalid(() => parsePublishFirst({ ...c, content: { ...c.content, body: c.content.body + 'a' } }));
        for (const fileVersionIds of [['file-1', 'file-1'], [...c.content.fileVersionIds, 'file-11'], [{ id: 'PRIVATE_CANARY' }]]) invalid(() => parsePublishFirst({ ...c, content: { ...content(), fileVersionIds } }));
    });
    it('A20 rejects unknown discriminants and branch-confused command bodies', () => {
        invalid(() => parseInquiryCommand({ ...answer(), command: 'complete_task' }));
        invalid(() => parseInquiryCommand({ ...answer(), expectedRevision: 1 }));
        invalid(() => parseInquiryCommand({ command: 'read', throughMessageId: 'message-1', idempotencyKey: 'read-1', content: content() }));
        invalid(() => parseCreateConversationDraft({ ...create(), taskId: '' }));
    });
    it('AC09-01 validates external wait with actual non-UTC offset and date-only next check', () => {
        expect(parseInquiryCommand(wait())).toEqual(wait());
        const unknownSent = { ...wait(), externalWait: { ...wait().externalWait, sentAt: null } };
        expect(parseInquiryCommand(unknownSent)).toEqual(unknownSent);
        const halfHour = wait(); halfHour.externalWait.sentAt = '2026-09-21T09:30:15.123+05:30';
        expect(parseInquiryCommand(halfHour)).toEqual(halfHour);
    });
    it('AC09-01 rejects normalized impossible days, time overflow, absent offsets and invalid timezone', () => {
        for (const sentAt of ['2026-02-30T09:00:00+09:00', '2026-09-21T24:00:00Z', '2026-09-21T09:60:00Z', '2026-09-21T09:00:00']) invalid(() => parseInquiryCommand({ ...wait(), externalWait: { ...wait().externalWait, sentAt } }));
        for (const nextCheckDate of ['2026-02-29', '2026-09-31', '2026-09-21T00:00:00Z']) invalid(() => parseInquiryCommand({ ...wait(), externalWait: { ...wait().externalWait, nextCheckDate } }));
        invalid(() => parseInquiryCommand({ ...wait(), externalWait: { ...wait().externalWait, timezone: 'PRIVATE_CANARY' } }));
    });
    it('AC09-01 requires external metadata only for external state; prior facts are server history', () => {
        invalid(() => parseInquiryCommand({ ...wait(), externalWait: null }));
        invalid(() => parseInquiryCommand({ ...wait(), externalWait: { ...wait().externalWait, responsibleUserId: '' } }));
        invalid(() => parseInquiryCommand({ ...wait(), state: 'gsg_waiting' }));
        const resume = { ...wait(), state: 'gsg_waiting', externalWait: null };
        expect(parseInquiryCommand(resume)).toEqual(resume);
    });
    it('AC09-04 accepts a distinct CAS link command without actor or message mutation fields', () => {
        const input = { command: 'link_task', taskId: 'task-1', expectedRevision: 3, idempotencyKey: 'link-1' };
        expect(parseInquiryCommand(input)).toEqual(input);
        invalid(() => parseInquiryCommand({ ...input, expectedRevision: 0 }));
        invalid(() => parseInquiryCommand({ ...input, taskId: null }));
        invalid(() => parseInquiryCommand({ ...input, submissionId: 'submission-1' }));
    });
    it('AC09-05 new question has its own identity without client overwriting resolution history', () => {
        const input = { command: 'question', expectedRevision: 5, content: content(), idempotencyKey: 'new-question-1' };
        expect(parseInquiryCommand(input)).toEqual(input);
        invalid(() => parseInquiryCommand({ ...input, resolvedAt: null }));
    });
    it('AC09-02 read accepts only an exact target message and stable intent', () => {
        const input = { command: 'read', throughMessageId: 'message-1', idempotencyKey: 'read-1' };
        expect(parseInquiryCommand(input)).toEqual(input);
        invalid(() => parseInquiryCommand({ ...input, throughMessageId: '' }));
        invalid(() => parseInquiryCommand({ ...input, userId: 'foreign-user' }));
    });
    it('A19 IDs retain exact accepted identifier convention, rejecting path/control/whitespace input', () => {
        expect(inquiryId('ctx-jp-a_luna')).toBe('ctx-jp-a_luna'); expect(inquiryId('a'.repeat(160))).toHaveLength(160);
        for (const id of ['a'.repeat(161), 'a/b', 'a\nb', ' id ', '', 5]) invalid(() => inquiryId(id));
    });
    it('A19 list query uses strict bounded numbers and rejects duplicate/unknown/empty keys', () => {
        expect(parseInquiryListQuery(new URLSearchParams('context=ctx-a'))).toEqual({ contextId: 'ctx-a', taskId: null, state: 'all', limit: 30, offset: 0 });
        expect(parseInquiryListQuery(new URLSearchParams('context=ctx-a&task=task-1&state=unresolved&limit=100&offset=100000')).limit).toBe(100);
        for (const q of ['context=ctx-a&context=ctx-b', 'context=ctx-a&task=', 'context=ctx-a&limit=0', 'context=ctx-a&limit=101', 'context=ctx-a&offset=1.5', 'context=ctx-a&offset=1e2', 'context=ctx-a&offset=-1', 'context=ctx-a&unknown=x']) invalid(() => parseInquiryListQuery(new URLSearchParams(q)));
    });
    it('AC09-03 bounds opaque catch-up tokens without decoding or asserting authorization', () => {
        const token = 'aB_9-'.repeat(8);
        expect(parseInquiryEventsQuery(new URLSearchParams({ after: token, limit: '2' }))).toEqual({ after: token, limit: 2 });
        expect(parseInquiryEventsQuery(new URLSearchParams())).toEqual({ after: null, limit: 50 });
        for (const q of ['after=', 'after=short', 'after='+ 'a'.repeat(513), 'after='+token+'&after='+token, 'after='+token+'&view=staff', 'limit=101', 'limit=01']) invalid(() => parseInquiryEventsQuery(new URLSearchParams(q)));
        // A syntactically valid foreign cursor is deliberately left for the current-auth server lookup.
        expect(parseInquiryEventsQuery(new URLSearchParams({ after: 'foreign_context_'.repeat(3) })).after).not.toBeNull();
    });
});
