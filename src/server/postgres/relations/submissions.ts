// Explicit asynchronous counterpart of src/domain/submissions/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { asyncSome } from './helpers';
import { StoreError, type RecordInput, type RecordKind } from "@/domain/records";
import type { SubmissionData, SubmissionDraftData } from "@/domain/submissions/types";
export async function submissionRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'submissionDraft' && kind !== 'submission')
        return;
    const d = input.data as SubmissionDraftData | SubmissionData, task = (await s.get('task', d.taskId));
    if (!task || task.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    const requestId = kind === 'submission' ? (d as SubmissionData).requestId : (d as SubmissionDraftData).baseRequestId;
    if ((await s.get('requestVersion', requestId))?.data.taskId !== d.taskId)
        throw new StoreError('INVALID_RECORD');
    if (kind === 'submissionDraft') {
        if ((await s.list('submissionDraft')).some(r => r.id !== input.id && r.data.taskId === d.taskId))
            throw new StoreError('CONFLICT');
        return;
    }
    const snapshot = d as SubmissionData;
    if ((await s.get('submission', input.id)))
        throw new StoreError('INVALID_RECORD');
    if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1 || (await s.get('submissionDraft', snapshot.draftId))?.data.taskId !== snapshot.taskId || snapshot.previousId && (await s.get('submission', snapshot.previousId))?.data.taskId !== snapshot.taskId)
        throw new StoreError('INVALID_RECORD');
    if ((await s.list('submission')).some(r => r.data.taskId === snapshot.taskId && r.data.sequence === snapshot.sequence || r.data.draftId === snapshot.draftId && r.data.committedDraftRevision === snapshot.committedDraftRevision))
        throw new StoreError('CONFLICT');
    if ((await asyncSome(snapshot.fileVersionIds, async (id) => (await s.get('fileVersion', id))?.contextId !== input.contextId)) || (await asyncSome(snapshot.productUseIds, async (id) => (await s.get('productUseSnapshot', id))?.data.ownerId !== input.id)))
        throw new StoreError('INVALID_RECORD');
}
