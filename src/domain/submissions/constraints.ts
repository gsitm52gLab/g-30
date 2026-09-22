import { StoreError, type RecordInput, type RecordKind, type SyncUnitOfWork as UnitOfWork } from '../records';
import type { SubmissionData, SubmissionDraftData } from './types';
export function submissionRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'submissionDraft' && kind !== 'submission')
        return;
    const d = input.data as SubmissionDraftData | SubmissionData, task = s.get('task', d.taskId);
    if (!task || task.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    const requestId = kind === 'submission' ? (d as SubmissionData).requestId : (d as SubmissionDraftData).baseRequestId;
    if (s.get('requestVersion', requestId)?.data.taskId !== d.taskId)
        throw new StoreError('INVALID_RECORD');
    if (kind === 'submissionDraft') {
        if (s.list('submissionDraft').some(r => r.id !== input.id && r.data.taskId === d.taskId))
            throw new StoreError('CONFLICT');
        return;
    }
    const snapshot = d as SubmissionData;
    if (s.get('submission', input.id))
        throw new StoreError('INVALID_RECORD');
    if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1 || s.get('submissionDraft', snapshot.draftId)?.data.taskId !== snapshot.taskId || snapshot.previousId && s.get('submission', snapshot.previousId)?.data.taskId !== snapshot.taskId)
        throw new StoreError('INVALID_RECORD');
    if (s.list('submission').some(r => r.data.taskId === snapshot.taskId && r.data.sequence === snapshot.sequence || r.data.draftId === snapshot.draftId && r.data.committedDraftRevision === snapshot.committedDraftRevision))
        throw new StoreError('CONFLICT');
    if (snapshot.fileVersionIds.some(id => s.get('fileVersion', id)?.contextId !== input.contextId) || snapshot.productUseIds.some(id => s.get('productUseSnapshot', id)?.data.ownerId !== input.id))
        throw new StoreError('INVALID_RECORD');
}
