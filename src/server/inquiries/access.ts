import { asyncFilter } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize, decide, activeMember, canAdmin } from '@/server/policy/policy';
import type { ResourceScope } from '@/server/policy/types';
import { fail, unavailable } from '@/server/auth/errors';
import { taskScope } from '@/server/policy/projection';
import * as safe from './stored';
export function inquiryScope(row: StoredRecord<'conversation'>): ResourceScope {
    const d = safe.conversation(row.data);
    return { id: row.id, contextId: row.contextId, kind: 'inquiry', visibility: d.phase === 'draft' ? 'draft' : 'public', audienceUserIds: [d.initiatorId], ...(d.phase === 'draft' ? { privateOwnerId: d.initiatorId } : {}) };
}
export async function resolveInquiry(s: UnitOfWork, p: Principal, id: string, clock: Clock, manage = false) {
    const row = (await s.get('conversation', id));
    if (!row?.contextId)
        unavailable();
    // Reject foreign participants before interpreting protected content.
    if (row.data.phase === 'draft' && row.data.initiatorId !== p.user.id || p.user.data.role === 'brand' && row.data.initiatorId !== p.user.id)
        unavailable();
    const scope = inquiryScope(row);
    (await authorize(s, p, manage ? 'inquiry.manage' : 'inquiry.read', scope, clock));
    return { row, scope };
}
export async function activeInquiry(s: UnitOfWork, p: Principal, id: string, clock: Clock, manage = false) {
    const r = (await resolveInquiry(s, p, id, clock, manage));
    if (r.row.data.phase !== 'active')
        fail('CONFLICT', 409, '첫 질문을 전송한 뒤 사용할 수 있습니다.');
    return r;
}
export async function taskReference(s: UnitOfWork, p: Principal, id: string, contextId: string, clock: Clock, manage = false) {
    const task = (await s.get('task', id));
    if (!task || task.contextId !== contextId)
        unavailable();
    (await authorize(s, p, manage ? 'task.manage' : 'task.read', taskScope(task), clock));
    return task;
}
export async function visibleTask(s: UnitOfWork, p: Principal, id: string | null, contextId: string, clock: Clock) {
    if (!id)
        return null;
    const t = (await s.get('task', id));
    return t && t.contextId === contextId && (await decide(s, p, 'task.read', taskScope(t), clock)).allowed ? { id: t.id, title: safe.text(t.data.title, 200) } : null;
}
export async function staff(s: UnitOfWork, contextId: string) {
    return (await asyncFilter((await s.list('user')), async (u) => u.data.role === 'gsg' && u.data.status === 'active' && (canAdmin(u, contextId) || (await activeMember(s, u.id, contextId))?.data.role === 'operator')));
}
export async function label(s: UnitOfWork, p: Principal, userId: string, contextId: string) {
    const u = (await s.get('user', userId));
    return u && (u.id === p.user.id || u.data.status === 'active' && ((await activeMember(s, u.id, contextId)) || canAdmin(u, contextId))) ? safe.text(u.data.name, 200) : '이전 참여자';
}
export async function releasedInquiryFile(s: UnitOfWork, p: Principal, file: StoredRecord<'fileVersion'>, clock: Clock, messageId?: string) {
    const owner = file.data.owner;
    if (owner?.kind !== 'inquiry')
        return false;
    const { row } = (await resolveInquiry(s, p, owner.conversationId, clock));
    if (row.contextId !== file.contextId)
        return false;
    const rows = messageId ? [(await s.get('inquiryMessage', messageId))].filter((x): x is StoredRecord<'inquiryMessage'> => !!x) : (await s.list('inquiryMessage', row.contextId!));
    return rows.some(m => { if (m.data.conversationId !== row.id || m.contextId !== row.contextId)
        return false; const d = safe.message(m.data); return d.fileVersionIds.includes(file.id) && (d.visibility === 'public' || p.user.data.role === 'gsg'); });
}
export async function inquiryFileScope(s: UnitOfWork, p: Principal, file: StoredRecord<'fileVersion'>, clock: Clock): Promise<ResourceScope> {
    const owner = file.data.owner;
    if (owner?.kind !== 'inquiry')
        unavailable();
    const r = (await resolveInquiry(s, p, owner.conversationId, clock));
    if (r.row.contextId !== file.contextId)
        unavailable();
    if (!(await releasedInquiryFile(s, p, file, clock)))
        return { ...r.scope, privateOwnerId: file.data.uploaderId };
    return r.scope;
}
export async function inquiryFileIncluded(s: UnitOfWork, p: Principal, file: StoredRecord<'fileVersion'>, conversationId: string, clock: Clock, messageId?: string) {
    const r = (await resolveInquiry(s, p, conversationId, clock));
    if (file.data.owner?.kind !== 'inquiry' || file.data.owner.conversationId !== r.row.id || file.contextId !== r.row.contextId)
        return false;
    if (messageId)
        return (await releasedInquiryFile(s, p, file, clock, messageId));
    return file.data.uploaderId === p.user.id;
}
