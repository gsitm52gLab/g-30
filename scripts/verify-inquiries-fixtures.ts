import { asyncMap } from "@/domain/async-collections";
import { createHash } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
export interface InquiryFixtureInput {
    conversationId: string;
    action?: 'extend' | 'malform';
}
/** Private test IPC/repository fixture; never registered as a product route. */
export async function inquiryFixture(repo: RecordRepository, input: InquiryFixtureInput) {
    return repo.transaction(async (s) => {
        const c = (await s.get('conversation', input.conversationId));
        if (!c)
            throw Error('owned conversation missing');
        if (input.action === 'extend')
            (await s.update('conversation', c.id, c.revision, { ...c.data, unknownExtension: { private: 'G09_STORED_EXTENSION' } } as unknown as typeof c.data));
        if (input.action === 'malform')
            (await s.update('conversation', c.id, c.revision, { ...c.data, title: { private: 'G09_MALFORMED_TITLE' } } as unknown as typeof c.data));
        const ownKinds: RecordKind[] = ['conversation', 'inquiryQuestion', 'inquiryMessage', 'inquiryRead', 'inquiryTransition', 'inquiryTaskLink', 'inquiryEvent'];
        const rows = (await asyncMap(ownKinds, async (kind) => ({ kind, rows: (await s.list(kind, c.contextId!)).filter(r => r.id === c.id || 'conversationId' in r.data && r.data.conversationId === c.id) })));
        const unchangedKinds: RecordKind[] = ['task', 'requestVersion', 'submission', 'submissionDraft', 'productUseSnapshot', 'notice', 'noticeVersion', 'noticeRead'];
        const unrelated = (await asyncMap(unchangedKinds, async (kind) => ({ kind, rows: (await s.list(kind)) })));
        const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        return { rows, rowsSha256: sha(rows), unrelatedSha256: sha(unrelated), messages: (await s.list('inquiryMessage', c.contextId!)).filter(m => m.data.conversationId === c.id), fileRows: (await s.list('fileVersion', c.contextId!)).filter(f => f.data.owner?.kind === 'inquiry' && f.data.owner.conversationId === c.id) };
    });
}
export type InquiryFixtureSnapshot = Awaited<ReturnType<typeof inquiryFixture>>;
