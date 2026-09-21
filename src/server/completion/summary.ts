import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { completionTask } from './access';
import * as safe from './stored';
/** Pure summary does not import submission read/collection, so it composes without a cycle. */
export function readCompletionSummary(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const task = completionTask(s, p, taskId, clock), rows = s.list('completionSnapshot', task.contextId!).filter(c => c.data.taskId === task.id).sort((a, b) => safe.count(b.data.sequence, 1) - safe.count(a.data.sequence, 1)), latest = rows[0];
    return { connected: true as const, status: task.data.status === 'completed' ? 'completed' as const : latest ? 'reopened' as const : 'not_completed' as const, latestCompletionId: latest ? safe.id(latest.id) : null, latestCompletedAt: latest ? safe.time(latest.data.completedAt) : null };
}
