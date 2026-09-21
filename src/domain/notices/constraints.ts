import { StoreError, type RecordKind, type RecordInput, type UnitOfWork } from '../records';
export function noticeRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['notice', 'noticeVersion', 'noticeRead'].includes(kind))
        return;
    if (!input.contextId || !s.get('context', input.contextId))
        throw new StoreError('INVALID_RECORD');
    if (kind === 'notice') {
        const data = input.data as import('./types').NoticeData;
        if (!s.get('user', data.createdBy) || data.currentVersionId && s.get('noticeVersion', data.currentVersionId)?.data.noticeId !== input.id)
            throw new StoreError('INVALID_RECORD');
        return;
    }
    if (s.get(kind, input.id))
        throw new StoreError('INVALID_RECORD');
    const data = input.data as import('./types').NoticeVersionData | import('./types').NoticeReadData;
    if (s.get('notice', data.noticeId)?.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    if (kind === 'noticeVersion') {
        const v = data as import('./types').NoticeVersionData;
        if (!Number.isSafeInteger(v.sequence) || v.sequence < 1 || v.previousId && s.get('noticeVersion', v.previousId)?.data.noticeId !== v.noticeId)
            throw new StoreError('INVALID_RECORD');
        if (s.list('noticeVersion').some(r => r.data.noticeId === v.noticeId && r.data.sequence === v.sequence))
            throw new StoreError('CONFLICT');
    }
    else {
        const r = data as import('./types').NoticeReadData;
        if (s.get('noticeVersion', r.versionId)?.data.noticeId !== r.noticeId || !s.get('user', r.userId))
            throw new StoreError('INVALID_RECORD');
        if (s.list('noticeRead').some(x => x.data.versionId === r.versionId && x.data.userId === r.userId))
            throw new StoreError('CONFLICT');
    }
}
