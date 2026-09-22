import { asyncMap } from "@/domain/async-collections";
import { createHash, randomUUID } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
import type { PublishedBatchData } from '@/domain/corrections/types';
export interface CorrectionFixtureInput {
    taskId: string;
    action?: 'extension' | 'corruption';
    batchId?: string;
}
/** Private runner observer/corruption fixture only; not an application route. */
export async function correctionFixture(repo: RecordRepository, input: CorrectionFixtureInput) {
    return repo.transaction(async (s) => {
        const task = (await s.get('task', input.taskId));
        if (!task)
            throw Error('Synthetic task missing');
        let fixtureBatchId: string | null = null;
        if (input.action) {
            const old = (await s.get('correctionBatch', input.batchId!))!;
            if (!old)
                throw Error('Synthetic batch missing');
            const draft = (await s.get('correctionDraft', old.data.draftId))!;
            const d = (await s.create('correctionDraft', { id: randomUUID(), contextId: task.contextId, data: { ...draft.data, publishedVersionId: null } }));
            const data = { ...old.data, draftId: d.id, sequence: Math.max(...(await s.list('correctionBatch', task.contextId!)).filter(b => b.data.taskId === task.id).map(b => b.data.sequence)) + 1, extension: { secret: 'G10_STORED_PRIVATE' }, items: old.data.items.map(i => ({ ...i, extension: { secret: 'G10_STORED_PRIVATE' }, target: { ...i.target, location: { ...i.target.location, extension: 'G10_STORED_PRIVATE' } } })), ...input.action === 'corruption' ? { summary: { secret: 'G10_KNOWN_CORRUPT' } } : {} };
            const b = (await s.create('correctionBatch', { id: randomUUID(), contextId: task.contextId, data: data as unknown as PublishedBatchData }));
            (await s.update('correctionDraft', d.id, d.revision, { ...d.data, publishedVersionId: b.id }));
            fixtureBatchId = b.id;
        }
        const kinds: RecordKind[] = ['correctionOpinion', 'correctionOpinionVersion', 'correctionDraft', 'correctionBatch', 'correctionItemState', 'correctionReflection', 'correctionResolution', 'correctionReview', 'domainEvent', 'commandReceipt', 'audit'];
        const rows = (await asyncMap(kinds, async (kind) => ({ kind, rows: (await s.list(kind, task.contextId!)).filter(r => 'taskId' in r.data && r.data.taskId === task.id || 'targetId' in r.data && r.data.targetId === task.id || kind === 'commandReceipt' && 'command' in r.data && String(r.data.command).includes(task.id) || kind === 'audit' && 'action' in r.data && r.data.action.startsWith('correction.') || kind === 'correctionOpinionVersion' && 'target' in r.data && (r.data.target as {
                taskId: string;
            }).taskId === task.id) })));
        const business = (await asyncMap((['task', 'requestVersion', 'submission', 'submissionDraft', 'productUseSnapshot', 'fileVersion'] as const), async (kind) => ({ kind, rows: (await s.list(kind, task.contextId!)) }))), hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        return { rows, business, rowsSha256: hash(rows), businessSha256: hash(business), fixtureBatchId };
    });
}
export type CorrectionFixtureSnapshot = Awaited<ReturnType<typeof correctionFixture>>;
