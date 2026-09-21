import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { activeMember, authorize, canAdmin } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { taskScope } from '@/server/policy/projection';
import type { CurrentRecipient } from '@/domain/notifications/types';

export function currentActor(s: UnitOfWork, p: Principal, contextId: string, clock: Clock): Principal {
    authorize(s, p, 'context.read', contextResource(contextId), clock);
    const user = s.get('user', p.user.id); if (!user) unavailable();
    return { ...p, user };
}
export function sourceTask(s: UnitOfWork, p: Principal, id: string, clock: Clock) {
    const t = s.get('task', id); if (!t?.contextId) unavailable();
    authorize(s, p, 'task.read', taskScope(t), clock); return t;
}
export function activeRecipientIds(s: UnitOfWork, contextId: string, ids: readonly string[], role: 'brand' | 'gsg') {
    return [...new Set(ids)].filter(id => {
        const u = s.get('user', id), m = activeMember(s, id, contextId);
        return u?.data.status === 'active' && u.data.role === role && (role === 'gsg' && canAdmin(u, contextId) || m?.data.role === (role === 'gsg' ? 'operator' : 'brand'));
    });
}
export const brandRecipientIds = (s: UnitOfWork, task: StoredRecord<'task'>) => activeRecipientIds(s, task.contextId!, [task.data.assigneeId, ...(task.data.coAssigneeIds ?? [])], 'brand');
export const ownerRecipientIds = (s: UnitOfWork, task: StoredRecord<'task'>) => activeRecipientIds(s, task.contextId!, [task.data.ownerId], 'gsg');
/** Caller has already checked this exact source's current read authorization. */
export function recipientFacts(p: Principal, ids: readonly string[]) {
    const own = ids.includes(p.user.id);
    return { recipient: own ? { id: p.user.id, role: p.user.data.role, active: true, sourceReadable: true } satisfies CurrentRecipient : null, recipientState: !ids.length ? 'needs_assignment' as const : own ? 'current_recipient' as const : 'other_recipient' as const };
}
