import { createHash, randomUUID } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
import type { CompletionRecords } from '@/domain/completion/types';
import { IdentityService } from '@/server/auth/service';
import { CompletionService } from '@/server/completion/service';
export interface CompletionFixtureInput {
    taskId: string;
    action?: 'extension' | 'corruption' | 'lateFault';
    snapshotId?: string;
    token?: string;
    command?: unknown;
}
/** Private observer/adversarial fixture; never a product HTTP endpoint. */
export async function completionFixture(repo: RecordRepository, input: CompletionFixtureInput) {
    let fault: string | null = null;
    if (input.action === 'lateFault')
        try {
            await new CompletionService(new IdentityService(repo), () => { throw Error('G11_PRIVATE_LATE_COMMIT_FAULT'); }).command(input.token, input.command);
        }
        catch (e) {
            fault = e instanceof Error ? e.message : 'fault';
        }
    return repo.transaction(s => {
        const task = s.get('task', input.taskId);
        if (!task)
            throw Error('own task missing');
        let fixtureSnapshotId: string | null = null;
        if (input.action === 'extension' || input.action === 'corruption') {
            const original = s.get('completionSnapshot', input.snapshotId!)!;
            if (!original)
                throw Error('own completion missing');
            const sequence = Math.max(...s.list('completionSnapshot', task.contextId!).filter(r => r.data.taskId === task.id).map(r => r.data.sequence)) + 1;
            const data = { ...original.data, sequence, extra: { private: 'G11_STORED_EXTRA' }, basis: { ...original.data.basis, extra: { private: 'G11_STORED_EXTRA' } }, ...input.action === 'corruption' ? { completedAt: { private: 'G11_KNOWN_MALFORMED' } } : {} };
            fixtureSnapshotId = s.create('completionSnapshot', { id: randomUUID(), contextId: task.contextId, data: data as unknown as CompletionRecords['completionSnapshot'] }).id;
        }
        const kinds: RecordKind[] = ['task', 'requestVersion', 'submissionDraft', 'submission', 'productUseSnapshot', 'fileVersion', 'conversation', 'inquiryQuestion', 'inquiryMessage', 'inquiryTransition', 'correctionOpinion', 'correctionOpinionVersion', 'correctionDraft', 'correctionBatch', 'correctionItemState', 'correctionReflection', 'correctionResolution', 'correctionReview', 'completionSnapshot', 'completionReopen', 'completionExternalAction', 'completionFollowup', 'domainEvent', 'commandReceipt', 'audit'];
        const rows = kinds.map(kind => ({ kind, rows: s.list(kind, task.contextId!) }));
        const completion = rows.filter(x => ['completionSnapshot', 'completionReopen', 'completionExternalAction', 'completionFollowup'].includes(x.kind));
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        return { rows, rowsSha256: hash(rows), completionSha256: hash(completion), fixtureSnapshotId, fault };
    });
}
export type CompletionFixtureSnapshot = Awaited<ReturnType<typeof completionFixture>>;
