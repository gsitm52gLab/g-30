// Explicit asynchronous counterpart of src/domain/notices/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
export async function noticeRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['notice', 'noticeVersion', 'noticeRead'].includes(kind))
        return;
    if (!input.contextId || !(await s.get('context', input.contextId)))
        throw new StoreError('INVALID_RECORD');
    if (kind === 'notice') {
        const data = input.data as import("@/domain/notices/types").NoticeData;
        if (!(await s.get('user', data.createdBy)) || data.currentVersionId && (await s.get('noticeVersion', data.currentVersionId))?.data.noticeId !== input.id)
            throw new StoreError('INVALID_RECORD');
        return;
    }
    if ((await s.get(kind, input.id)))
        throw new StoreError('INVALID_RECORD');
    const data = input.data as import("@/domain/notices/types").NoticeVersionData | import("@/domain/notices/types").NoticeReadData;
    if ((await s.get('notice', data.noticeId))?.contextId !== input.contextId)
        throw new StoreError('INVALID_RECORD');
    if (kind === 'noticeVersion') {
        const v = data as import("@/domain/notices/types").NoticeVersionData;
        if (!Number.isSafeInteger(v.sequence) || v.sequence < 1 || v.previousId && (await s.get('noticeVersion', v.previousId))?.data.noticeId !== v.noticeId)
            throw new StoreError('INVALID_RECORD');
        if ((await s.list('noticeVersion')).some(r => r.data.noticeId === v.noticeId && r.data.sequence === v.sequence))
            throw new StoreError('CONFLICT');
    }
    else {
        const r = data as import("@/domain/notices/types").NoticeReadData;
        if ((await s.get('noticeVersion', r.versionId))?.data.noticeId !== r.noticeId || !(await s.get('user', r.userId)))
            throw new StoreError('INVALID_RECORD');
        if ((await s.list('noticeRead')).some(x => x.data.versionId === r.versionId && x.data.userId === r.userId))
            throw new StoreError('CONFLICT');
    }
}
