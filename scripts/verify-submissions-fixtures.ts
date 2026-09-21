import { createHash } from 'node:crypto';
import type { RecordRepository } from '@/domain/records';
export interface SubmissionFixtureInput {
    taskId: string;
}
export async function submissionFixture(repo: RecordRepository, input: SubmissionFixtureInput) {
    return repo.transaction(s => {
        const task = s.get('task', input.taskId);
        if (!task)
            throw new Error('fixture task missing');
        const rows = s.list('submission', task.contextId!).filter(v => v.data.taskId === task.id), draft = s.list('submissionDraft', task.contextId!).find(v => v.data.taskId === task.id);
        const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        return { taskId: task.id, taskStatus: task.data.status, draftRevision: draft?.revision ?? 0, draftSha256: draft ? hash(draft) : null,
            submissions: rows.map(v => ({ id: v.id, sequence: v.data.sequence, sha256: hash(v), contentHash: v.data.contentHash, providedBy: v.data.providedBy, recordedBy: v.data.recordedBy, requestId: v.data.requestId, productUseIds: v.data.productUseIds })),
            files: s.list('fileVersion', task.contextId!).filter(f => f.data.taskId === task.id).map(f => ({ id: f.id, uploaderId: f.data.uploaderId, createdAt: f.createdAt, sha256: f.data.sha256, recordSha256: hash(f) })),
            uses: s.list('productUseSnapshot', task.contextId!).filter(v => v.data.taskId === task.id).map(v => ({ id: v.id, ownerType: v.data.ownerType, ownerId: v.data.ownerId, sha256: hash(v) })),
            audits: s.list('audit', task.contextId!).filter(v => v.data.targetId === task.id && v.data.action === 'submission.created').length,
            events: s.list('domainEvent', task.contextId!).filter(v => v.data.targetId === task.id && v.data.eventType === 'TASK_SUBMITTED').length };
    });
}
export type SubmissionFixtureSnapshot = Awaited<ReturnType<typeof submissionFixture>>;
