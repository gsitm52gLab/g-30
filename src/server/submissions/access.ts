import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import type { Provider } from '@/domain/submissions/types';
import { parseProvider } from '@/domain/submissions/validate';
import type { Principal } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { authorize, decide, activeMember } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
export function submissionTask(s: UnitOfWork, p: Principal, taskId: string, clock: Clock, edit = false) {
    const task = s.get('task', taskId);
    if (!task?.contextId)
        unavailable();
    authorize(s, p, 'task.read', taskScope(task), clock);
    if (edit)
        authorize(s, p, 'submission.write', taskScope(task), clock);
    if (task.data.schemaVersion !== 2 || task.data.visibility !== 'public' || !task.data.currentRequestId)
        fail('REQUEST_REQUIRED', 409, '공개된 요청이 있어야 답변할 수 있습니다.');
    const request = s.get('requestVersion', task.data.currentRequestId);
    if (!request || request.data.taskId !== task.id)
        unavailable();
    return { task, request };
}
export function capabilities(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, clock: Clock) {
    const edit = decide(s, p, 'submission.write', taskScope(task), clock).allowed;
    return { editDraft: edit && task.data.status !== 'completed', upload: edit && task.data.status !== 'completed', submit: edit && !['on_hold', 'cancelled', 'completed'].includes(task.data.status), proxy: edit && p.user.data.role === 'gsg' };
}
export function provider(s: UnitOfWork, p: Principal, contextId: string, value: unknown): Provider {
    if (p.user.data.role === 'brand') {
        if (value !== undefined) {
            const requested = parseProvider(value);
            if (requested.kind !== 'user' || requested.userId !== p.user.id)
                fail('FORBIDDEN', 403, '브랜드 답변의 제공자는 현재 사용자입니다.');
        }
        return { kind: 'user', userId: p.user.id };
    }
    const selected = parseProvider(value);
    if (selected.kind === 'user' && (!s.get('user', selected.userId) || !s.list('membership', contextId).some(m => m.data.userId === selected.userId)))
        fail('VALIDATION', 422, '이 컨텍스트에 참여한 자료 제공자를 선택해 주세요.');
    return selected;
}
export function userLabel(s: UnitOfWork, p: Principal, contextId: string, userId: string) {
    const user = s.get('user', userId);
    return user && (userId === p.user.id || user.data.status === 'active' && activeMember(s, userId, contextId)) ? user.data.name : '이전 참여자';
}
export function assertRequest(task: StoredRecord<'task'>, expected: unknown) {
    if (task.data.currentRequestId !== expected)
        fail('REQUEST_CHANGED', 409, '요청이 변경되었습니다. 입력을 유지한 채 변경 내용과 이전 답변을 확인해 주세요.');
}
export function assertDraft(revision: number, expected: unknown) {
    if (!Number.isSafeInteger(expected) || Number(expected) < 0)
        fail('VALIDATION', 422, '초안 버전을 확인해 주세요.');
    if (revision !== expected)
        fail('DRAFT_CHANGED', 409, '공유 초안이 변경되었습니다. 입력을 유지한 채 최신 초안과 비교해 주세요.');
}
