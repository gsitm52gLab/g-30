import type { IdentityService } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { scheduleContent } from '@/domain/scheduling/validate';
import { object, str, ids, enumValue, dateValue } from '@/domain/tasks/validate';
import { receipt, newId, audit, fresh } from '@/server/products/store';
import { sourceTask, currentActor, activeRecipientIds, actionRecipientIds } from './access';
import { calendarDTO, scheduleSources, visibleSource } from './read';
import { manualSchedule, manualVersionDTO } from './manual';
export class SchedulingService {
    constructor(public identity: IdentityService) {}
    get clock() { return this.identity.clock; }
    async list(token: string | undefined, contextId: string, options: { taskId?: string; kind?: string; from?: string; to?: string } = {}) {
        if (options.from) dateValue(options.from); if (options.to) dateValue(options.to);
        if (options.from && options.to && options.from > options.to) fail('VALIDATION', 422, '날짜 범위를 확인해 주세요.');
        return this.identity.repo.transaction(s => {
            const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock);
            if (options.taskId) sourceTask(s, p, options.taskId, this.clock);
            const items = scheduleSources(s, p, contextId, this.clock).map(row => calendarDTO(row, this.clock)).filter(r => (!options.taskId || r.taskId === options.taskId) && (!options.kind || r.kind === options.kind) && (!options.from || r.calendar.dueDay !== null && r.calendar.dueDay >= options.from) && (!options.to || r.calendar.dueDay !== null && r.calendar.dueDay <= options.to)).sort((a, b) => (a.calendar.dueDay ?? '9999').localeCompare(b.calendar.dueDay ?? '9999') || a.logicalKey.localeCompare(b.logicalKey));
            const tasks = s.list('task', contextId).flatMap(t => decide(s, p, 'task.manage', taskScope(t), this.clock).allowed ? [{ id: t.id, title: t.data.title }] : []);
            const actors = p.user.data.role === 'gsg' ? s.list('user').flatMap(u => { const taskIds = tasks.filter(t => actionRecipientIds(s, s.get('task', t.id)!, u.id).length).map(t => t.id); return taskIds.length ? [{ id: u.id, label: u.data.name, role: u.data.role, taskIds }] : []; }) : [];
            return { contextId, items, total: items.length, capabilities: { create: tasks.length > 0 }, tasks, actors, delivery: { inApp: 'app_open_sync' as const, email: 'not_connected' as const, background: 'not_connected' as const } };
        });
    }
    async detail(token: string | undefined, id: string) { return this.identity.repo.transaction(s => {
        const p = this.identity.principal(s, token), v = manualSchedule(s, p, id, this.clock);
        const versions = s.list('scheduleVersion', v.row.contextId!).filter(r => r.data.scheduleId === id).sort((a, b) => b.data.sequence - a.data.sequence).flatMap(r => { const dto = visibleSource(() => manualVersionDTO(s, p, id, this.clock, r)); return dto ? [dto] : []; });
        return { id, contextId: v.row.contextId!, revision: v.row.revision, currentVersionId: v.version.id, current: manualVersionDTO(s, p, id, this.clock, v.version), calendar: calendarDTO(v.source, this.clock), versions, capabilities: { manage: decide(s, p, 'task.manage', taskScope(v.task), this.clock).allowed } };
    }); }
    async command(token: string | undefined, input: unknown) {
        const x = object(input, ['command', 'contextId', 'scheduleId', 'expectedRevision', 'content', 'reason', 'idempotencyKey']);
        const command = enumValue(x.command, ['save', 'cancel', 'done', 'reopen'] as const), contextId = ids([x.contextId])[0], scheduleId = x.scheduleId === null ? null : ids([x.scheduleId])[0], reason = str(x.reason ?? '', 2000), content = command === 'save' ? scheduleContent(x.content) : null;
        if (!scheduleId && command !== 'save') unavailable();
        return this.identity.repo.transaction(s => {
            const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock), old = scheduleId ? manualSchedule(s, p, scheduleId, this.clock) : null;
            if (old && old.row.contextId !== contextId) unavailable();
            const c = content ?? old!.content, task = sourceTask(s, p, c.taskId, this.clock);
            authorize(s, p, 'task.manage', taskScope(task), this.clock);
            if (task.contextId !== contextId || old && old.row.data.taskId !== task.id) unavailable();
            if (!activeRecipientIds(s, contextId, [c.deadline.responsibleUserId], 'gsg').length && !activeRecipientIds(s, contextId, [c.deadline.responsibleUserId], 'brand').length) fail('VALIDATION', 422, '현재 일정 확인 담당자를 선택해 주세요.');
            if (!['brand_reply', 'submission', 'correction'].includes(c.kind) && !actionRecipientIds(s, task, c.deadline.responsibleUserId).length) fail('VALIDATION', 422, '이 업무의 현재 주·공동 담당자 또는 GSG 담당자를 선택해 주세요.');
            return receipt(s, p, contextId, `schedule.${command}:${scheduleId ?? 'new'}`, x, () => {
                fresh(old?.row ?? null, x.expectedRevision);
                const root = old?.row ?? s.create('schedule', { id: newId(), contextId, data: { taskId: task.id, currentVersionId: null, createdBy: p.user.id } });
                const state = command === 'save' ? old?.state ?? 'open' : command === 'cancel' ? 'cancelled' : command === 'done' ? 'done' : 'open';
                const v = s.create('scheduleVersion', { id: newId(), contextId, data: { scheduleId: root.id, sequence: (old?.version.data.sequence ?? 0) + 1, previousId: old?.version.id ?? null, content: c, state, changedBy: p.user.id, changedAt: this.clock(), reason } });
                s.update('schedule', root.id, root.revision, { ...root.data, currentVersionId: v.id });
                audit(s, p, this.clock, contextId, `schedule.${command}`, root.id, { versionId: old?.version.id ?? null }, { versionId: v.id, state });
                if (c.visibility === 'public') s.create('domainEvent', { id: newId(), contextId, data: { eventType: 'SCHEDULE_CHANGED', targetId: root.id, sourceVersionId: v.id, actorId: p.user.id, at: this.clock() } });
                return { ids: [root.id, v.id] };
            });
        });
    }
}
