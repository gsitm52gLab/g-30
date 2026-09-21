import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { unavailable } from '@/server/auth/errors';
import { identifier } from '@/domain/completion/validate';
export function completionTask(s: UnitOfWork, p: Principal, id: string, clock: Clock, write = false) {
    identifier(id);
    const task = s.get('task', id);
    if (!task?.contextId)
        unavailable();
    authorize(s, p, write ? 'task.complete' : 'task.read', taskScope(task), clock);
    return task;
}
export const mayComplete = (s: UnitOfWork, p: Principal, task: ReturnType<typeof completionTask>, clock: Clock) => decide(s, p, 'task.complete', taskScope(task), clock).allowed;
