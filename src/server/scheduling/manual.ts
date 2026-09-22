import { asyncSome } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { currentActor, sourceTask, recipientFacts, actionRecipientIds, brandRecipientIds } from './access';
import { sourceText } from './projection';
import { storedContent, storedState } from './stored';
import { currentSubmissionNeed, campaignSchedules } from './sources';
import type { SourceSchedule } from './types';
export async function manualSchedule(s: UnitOfWork, principal: Principal, id: string, clock: Clock, versionId?: string) {
    const row = (await s.get('schedule', id));
    if (!row?.contextId || !row.data.currentVersionId)
        unavailable();
    const p = (await currentActor(s, principal, row.contextId, clock)), task = (await sourceTask(s, p, row.data.taskId, clock));
    const current = (await s.get('scheduleVersion', row.data.currentVersionId)), version = versionId ? (await s.get('scheduleVersion', versionId)) : current;
    if (!current || !version || current.data.scheduleId !== id || version.data.scheduleId !== id || version.contextId !== row.contextId)
        unavailable();
    const content = storedContent(version.data.content), latest = storedContent(current.data.content);
    if (p.user.data.role !== 'gsg' && (content.visibility !== 'public' || latest.visibility !== 'public'))
        unavailable();
    const state = storedState(version.data.state), isSubmission = ['brand_reply', 'submission', 'correction'].includes(content.kind), recipientIds = isSubmission ? (await brandRecipientIds(s, task)) : (await actionRecipientIds(s, task, content.deadline.responsibleUserId));
    const request = task.data.currentRequestId ? (await s.get('requestVersion', task.data.currentRequestId)) : null;
    const recipientRole = (await s.get('user', content.deadline.responsibleUserId))?.data.role ?? 'gsg';
    const campaigns = (await s.list('campaign', row.contextId)).filter(c => c.data.taskId === task.id && c.data.currentVersionId);
    const participationActive = recipientRole !== 'brand' || campaigns.length === 0 || (await asyncSome(campaigns, async (c) => (await campaignSchedules(s, p, c.id, clock)).some(r => r.active)));
    const need = isSubmission ? request ? (await currentSubmissionNeed(s, p, task, request, clock)) : { kind: 'brand_submission' as const, taskStatus: task.data.status, sourceAvailable: false, required: false, remaining: 0, participation: 'ordinary' as const } : { kind: 'responsible_action' as const, taskStatus: task.data.status, sourceAvailable: true, pending: state === 'open', recipientRole, participationActive };
    const source: SourceSchedule = { logicalKey: `manual:${id}`, contextId: row.contextId, taskId: task.id, title: content.title, kind: content.kind, recipientPolicy: isSubmission ? 'task_assignees' : 'explicit_action_owner', nextAction: isSubmission ? '현재 업무 주·공동 담당자의 필수 자료 제출 · 기한 확인 주체와 별도' : '지정된 다음 행동 담당자의 진행 확인', source: { kind: 'manual', targetId: id, versionId: version.id, itemKey: 'deadline' }, sourceRevision: row.revision, deadline: content.deadline, visibility: content.visibility, actionUrl: `/schedule/${encodeURIComponent(id)}?context=${encodeURIComponent(row.contextId)}`, unresolvedConflict: content.conflicts.some(c => c.state === 'unresolved'), active: state === 'open', need, ...recipientFacts(p, recipientIds), reminderSupport: 'current_need' };
    return { row, task, p, version, content, source, state, latest };
}
export async function manualVersionDTO(s: UnitOfWork, p: Principal, id: string, clock: Clock, version: StoredRecord<'scheduleVersion'>) {
    const v = (await manualSchedule(s, p, id, clock, version.id)), actor = (await s.get('user', version.data.changedBy));
    return { id: version.id, sequence: version.data.sequence, previousId: version.data.previousId, content: v.content, state: v.state, changedAt: sourceText(version.data.changedAt), changedByLabel: actor && (actor.id === p.user.id || actor.data.status === 'active' && (await s.list('membership', v.row.contextId!)).some(m => m.data.userId === actor.id && m.data.status === 'active')) ? sourceText(actor.data.name) : '이전 담당자', reason: sourceText(version.data.reason, 2000) };
}
