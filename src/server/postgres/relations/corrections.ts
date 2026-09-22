// Explicit asynchronous counterpart of src/domain/corrections/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
export async function correctionRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!kind.startsWith('correction'))
        return;
    const d = input.data as unknown as Record<string, unknown>;
    const existing = (await s.get(kind, input.id));
    if (kind === 'correctionDraft' && (await s.get('correctionDraft', input.id))?.data.publishedVersionId)
        throw new StoreError('INVALID_RECORD');
    if (existing && 'taskId' in existing.data && 'taskId' in d && existing.data.taskId !== d.taskId)
        throw new StoreError('INVALID_RECORD');
    const immutable = ['correctionOpinionVersion', 'correctionBatch', 'correctionReflection', 'correctionResolution', 'correctionReview'].includes(kind);
    if (immutable && (await s.get(kind, input.id)))
        throw new StoreError('INVALID_RECORD');
    const taskId = kind === 'correctionOpinionVersion' ? (d.target as {
        taskId: string;
    })?.taskId : d.taskId;
    if (typeof taskId !== 'string' || (await s.get('task', taskId))?.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    const match = async (k: RecordKind, id: unknown) => typeof id === 'string' && (await s.get(k, id))?.contextId === input.contextId;
    if (kind === 'correctionOpinionVersion' && !(await match('correctionOpinion', d.opinionId)) || kind === 'correctionBatch' && !(await match('correctionDraft', d.draftId)))
        throw new StoreError('INVALID_RECORD');
    if (['correctionItemState', 'correctionReflection', 'correctionResolution'].includes(kind)) {
        if (!(await match('correctionBatch', d.batchVersionId)))
            throw new StoreError('INVALID_RECORD');
        const b = (await s.get('correctionBatch', d.batchVersionId as string))!;
        if (b.data.taskId !== taskId || !b.data.items.some(i => i.key === d.itemKey))
            throw new StoreError('INVALID_RECORD');
    }
    if (kind === 'correctionOpinionVersion' && (await s.list('correctionOpinionVersion')).some(r => r.id !== input.id && r.data.opinionId === d.opinionId && r.data.sequence === d.sequence) || kind === 'correctionBatch' && (await s.list('correctionBatch')).some(r => r.id !== input.id && (r.data.taskId === taskId && r.data.sequence === d.sequence || r.data.draftId === d.draftId)) || kind === 'correctionItemState' && (await s.list('correctionItemState')).some(r => r.id !== input.id && r.data.batchVersionId === d.batchVersionId && r.data.itemKey === d.itemKey))
        throw new StoreError('CONFLICT');
}
