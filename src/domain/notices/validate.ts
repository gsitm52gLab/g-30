import { object, str, enumValue } from '@/domain/tasks/validate';
import { fail } from '@/server/auth/errors';
import { noticeTypes, type NoticeContent } from './types';
function ids(value: unknown, max = 100): string[] {
    if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string' || !/^[\w-]{1,160}$/.test(id)) || new Set(value).size !== value.length)
        fail('VALIDATION', 422, '대상과 연결 자료를 확인해 주세요.');
    return [...value];
}
export function noticeInput(value: unknown, publishing = false): NoticeContent {
    const v = object(value, ['title', 'body', 'type', 'category', 'documentVersion', 'audience', 'fileIds', 'taskIds', 'changeSummary']);
    const a = object(v.audience, ['mode', 'userIds']), mode = enumValue(a.mode, ['all', 'selected']), userIds = ids(a.userIds, 500);
    if (mode === 'all' && userIds.length)
        fail('VALIDATION', 422, '전체 대상에는 개별 사용자를 지정하지 않습니다.');
    return { title: str(v.title, 300, publishing), body: str(v.body, 30000, publishing), type: enumValue(v.type, noticeTypes), category: str(v.category, 200), documentVersion: str(v.documentVersion, 200), audience: { mode, userIds }, fileIds: ids(v.fileIds), taskIds: ids(v.taskIds), changeSummary: str(v.changeSummary, 2000) };
}
