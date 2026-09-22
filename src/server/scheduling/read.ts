import { userLabel } from '@/server/submissions/access';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { AuthError } from '@/server/auth/errors';
import { calendarPosition } from '@/domain/scheduling/calendar';
import { currentActor } from './access';
import { taskSchedules, campaignSchedules, inquirySchedules } from './sources';
import { manualSchedule } from './manual';
import { sourceReminderDecision } from '@/server/notifications/eligibility';
import type { SourceSchedule } from './types';
export function visibleSource<T>(fn: () => T): T | null { try { return fn(); } catch (e) { if (e instanceof AuthError && (e.status === 403 || e.status === 404)) return null; throw e; } }
/** Current source authorization happens before aggregation, dates, sorting or counts. */
export function scheduleSources(s: UnitOfWork, principal: Principal, contextId: string, clock: Clock): SourceSchedule[] {
    const p = currentActor(s, principal, contextId, clock), all: SourceSchedule[] = [];
    for (const t of s.list('task', contextId)) all.push(...(visibleSource(() => taskSchedules(s, p, t.id, clock)) ?? []));
    for (const c of s.list('campaign', contextId)) all.push(...(visibleSource(() => campaignSchedules(s, p, c.id, clock)) ?? []));
    for (const c of s.list('conversation', contextId)) all.push(...(visibleSource(() => inquirySchedules(s, p, c.id, clock)) ?? []));
    for (const row of s.list('schedule', contextId)) { const v = visibleSource(() => manualSchedule(s, p, row.id, clock)); if (v) all.push(v.source); }
    return all;
}
export function calendarDTO(s: UnitOfWork, p: Principal, row: SourceSchedule, clock: Clock) {
    const decision = sourceReminderDecision(row, clock());
    return { confirmationParty: { id: row.deadline.responsibleUserId, label: userLabel(s, p, row.contextId, row.deadline.responsibleUserId) }, actionOwners: row.actionOwnerIds.map(id => ({ id, label: userLabel(s, p, row.contextId, id) })), logicalKey: row.logicalKey, contextId: row.contextId, taskId: row.taskId, title: row.title, kind: row.kind, source: row.source, sourceRevision: row.sourceRevision, deadline: row.deadline, visibility: row.visibility, actionUrl: row.actionUrl, active: row.active, unresolvedConflict: row.unresolvedConflict, calendar: calendarPosition(row.deadline, clock()), recipientState: row.recipientState, reminder: decision, reminderSupport: row.reminderSupport, recipientPolicy: row.recipientPolicy ?? (row.need?.kind === 'brand_submission' ? 'task_assignees' as const : row.need?.kind === 'gsg_external_check' ? 'external_gsg' as const : 'explicit_action_owner' as const), nextAction: row.nextAction ?? (row.need?.kind === 'brand_submission' ? '남은 필수 자료 확인' : row.need?.kind === 'gsg_external_check' ? '외부 진행 확인' : '일정 담당자의 진행 확인') };
}
