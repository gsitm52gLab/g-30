import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize, decide, activeMember } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { taskScope } from '@/server/policy/projection';
import { fail, unavailable } from '@/server/auth/errors';
import type { Provider } from '@/domain/submissions/types';
export async function campaignTask(s: UnitOfWork, p: Principal, taskId: string, clock: Clock, action: 'read' | 'manage' | 'respond' = 'read') {
    const task = (await s.get('task', taskId));
    if (!task?.contextId)
        unavailable();
    (await authorize(s, p, 'task.read', taskScope(task), clock));
    if (action === 'manage')
        (await authorize(s, p, 'task.manage', taskScope(task), clock));
    if (action === 'respond')
        (await authorize(s, p, 'submission.write', taskScope(task), clock));
    return task;
}
export async function manager(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) { const task = (await campaignTask(s, p, taskId, clock)); return p.user.data.role === 'gsg' && (await decide(s, p, 'task.manage', taskScope(task), clock)).allowed; }
export async function manageCatalog(s: UnitOfWork, p: Principal, contextId: string, clock: Clock) { (await authorize(s, p, 'context.read', contextResource(contextId), clock)); if (p.user.data.role !== 'gsg')
    fail('FORBIDDEN', 403, '카탈로그 원문은 GSG가 관리합니다.'); (await authorize(s, p, 'task.manage', { ...contextResource(contextId), kind: 'task' }, clock)); }
export async function provider(s: UnitOfWork, p: Principal, contextId: string, value: Provider, self = false): Promise<Provider> {
    if (self && p.user.data.role === 'brand' && (value.kind !== 'user' || value.userId !== p.user.id))
        fail('FORBIDDEN', 403, '브랜드 회신의 제공자는 현재 사용자입니다.');
    if (value.kind === 'user' && (!(await activeMember(s, value.userId, contextId)) || (await s.get('user', value.userId))?.data.status !== 'active'))
        fail('VALIDATION', 422, '현재 컨텍스트의 활성 제공자를 선택해 주세요.');
    return value;
}
export async function resolveCampaign(s: UnitOfWork, p: Principal, id: string, clock: Clock, action: 'read' | 'manage' | 'respond' = 'read') {
    const row = (await s.get('campaign', id));
    if (!row)
        unavailable();
    const task = (await campaignTask(s, p, row.data.taskId, clock, action));
    if (row.contextId !== task.contextId)
        unavailable();
    if (!row.data.currentVersionId && !(await manager(s, p, task.id, clock)))
        unavailable();
    return { row, task };
}
