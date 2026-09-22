import { createHash, randomUUID } from 'node:crypto';
import type { RecordRepository } from '@/domain/records';
export interface SubmissionFixtureInput {
    taskId: string;
    action?: 'poison_request';
}
export async function submissionFixture(repo: RecordRepository, input: SubmissionFixtureInput) {
    return repo.transaction(async (s) => {
        let task = (await s.get('task', input.taskId));
        if (!task)
            throw new Error('fixture task missing');
        if (input.action === 'poison_request') {
            const old = (await s.get('requestVersion', task.data.currentRequestId!))!;
            const data = { ...old.data, sequence: old.data.sequence + 1, previousId: old.id, content: { ...old.data.content, requirements: old.data.content.requirements.map(q => ({ ...q, label: { private: 'G05_HTTP_EVALUATION_CANARY' }, productIds: [{ private: 'G05_HTTP_EVALUATION_CANARY' }] })) } } as unknown as typeof old.data;
            const next = (await s.create('requestVersion', { id: randomUUID(), contextId: task.contextId, data }));
            task = (await s.update('task', task.id, task.revision, { ...task.data, currentRequestId: next.id }));
        }
        const rows = (await s.list('submission', task.contextId!)).filter(v => v.data.taskId === task.id), draft = (await s.list('submissionDraft', task.contextId!)).find(v => v.data.taskId === task.id);
        const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        const request = (await s.get('requestVersion', task.data.currentRequestId!))!;
        return { request: { id: request.id, sha256: hash(request), canaryStored: JSON.stringify(request).includes('G05_HTTP_EVALUATION_CANARY') }, taskId: task.id, taskStatus: task.data.status, draftRevision: draft?.revision ?? 0, draftSha256: draft ? hash(draft) : null,
            submissions: rows.map(v => ({ id: v.id, sequence: v.data.sequence, sha256: hash(v), contentHash: v.data.contentHash, providedBy: v.data.providedBy, recordedBy: v.data.recordedBy, requestId: v.data.requestId, productUseIds: v.data.productUseIds })),
            files: (await s.list('fileVersion', task.contextId!)).filter(f => f.data.taskId === task.id).map(f => ({ id: f.id, uploaderId: f.data.uploaderId, createdAt: f.createdAt, sha256: f.data.sha256, recordSha256: hash(f) })),
            uses: (await s.list('productUseSnapshot', task.contextId!)).filter(v => v.data.taskId === task.id).map(v => ({ id: v.id, ownerType: v.data.ownerType, ownerId: v.data.ownerId, sha256: hash(v) })),
            audits: (await s.list('audit', task.contextId!)).filter(v => v.data.targetId === task.id && v.data.action === 'submission.created').length,
            events: (await s.list('domainEvent', task.contextId!)).filter(v => v.data.targetId === task.id && v.data.eventType === 'TASK_SUBMITTED').length };
    });
}
export type SubmissionFixtureSnapshot = Awaited<ReturnType<typeof submissionFixture>>;
