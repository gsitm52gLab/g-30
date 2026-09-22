import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { fail, unavailable } from '@/server/auth/errors';
import { ids } from '@/domain/tasks/validate';
export async function correctionTask(s: UnitOfWork, p: Principal, taskId: string, clock: Clock, action: 'read' | 'manage' | 'reflect' = 'read') {
    ids([taskId]);
    const task = (await s.get('task', taskId));
    if (!task?.contextId)
        unavailable();
    (await authorize(s, p, 'task.read', taskScope(task), clock));
    if (action === 'manage')
        (await authorize(s, p, 'task.manage', taskScope(task), clock));
    if (action === 'reflect') {
        (await authorize(s, p, 'submission.write', taskScope(task), clock));
        if (p.user.data.role !== 'brand')
            fail('FORBIDDEN', 403, '반영 제출은 현재 브랜드 담당자가 기록합니다.');
    }
    return task;
}
export const canManage = async (s: UnitOfWork, p: Principal, task: Awaited<ReturnType<typeof correctionTask>>, clock: Clock) => (await decide(s, p, 'task.manage', taskScope(task), clock)).allowed;
