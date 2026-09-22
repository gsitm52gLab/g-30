// Explicit asynchronous counterpart of src/domain/completion/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordInput, type RecordKind } from "@/domain/records";
export async function completionRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!kind.startsWith('completion'))
        return;
    const d = input.data as unknown as Record<string, unknown>;
    if ((await s.get(kind, input.id)) || typeof d.taskId !== 'string' || !input.contextId || (await s.get('task', d.taskId))?.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    if (kind === 'completionSnapshot' || kind === 'completionExternalAction') {
        if (!Number.isSafeInteger(d.sequence) || Number(d.sequence) < 1)
            throw new StoreError('INVALID_RECORD');
        if ((await s.list(kind, input.contextId)).some(r => ('taskId' in r.data && r.data.taskId === d.taskId) && 'sequence' in r.data && r.data.sequence === d.sequence))
            throw new StoreError('CONFLICT');
    }
    if (kind === 'completionReopen' || kind === 'completionFollowup') {
        const c = typeof d.completionId === 'string' ? (await s.get('completionSnapshot', d.completionId)) : null;
        if (c?.contextId !== input.contextId || c.data.taskId !== d.taskId)
            throw new StoreError('INVALID_RECORD');
        if (kind === 'completionReopen' && (await s.list('completionReopen', input.contextId)).some(r => r.data.completionId === d.completionId))
            throw new StoreError('CONFLICT');
    }
    if (kind === 'completionFollowup' && (typeof d.followupTaskId !== 'string' || d.followupTaskId === d.taskId || (await s.get('task', d.followupTaskId))?.contextId !== input.contextId))
        throw new StoreError('INVALID_RECORD');
}
