import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { latestSubmission, snapshotDTO as submissionSnapshot } from '@/server/submissions/read';
import { requestRequirementsValid } from '@/domain/submissions/request';
import { safeEvaluation } from '@/server/submissions/projection';
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { resolveCampaign } from '@/server/campaigns/access';
import { versionDTO } from '@/server/campaigns/projection';
import { menuProgress } from '@/server/campaigns/read';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { activeInquiry, staff } from '@/server/inquiries/access';
import { questions } from '@/server/inquiries/projection';
import { currentActor, sourceTask, brandRecipientIds, recipientFacts, activeRecipientIds } from './access';
import { sourceDeadline, sourceText, taskActionUrl } from './projection';
import type { SourceSchedule } from './types';

/** Public submission facts only: no shared draft, prior-fixture or String(value) presence. */
export function currentSubmissionNeed(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, request: StoredRecord<'requestVersion'>, clock: Clock) {
    const latest = latestSubmission(s, task), old = latest ? s.get('requestVersion', latest.data.requestId) : null;
    if (latest && (!old || old.data.taskId !== task.id || old.contextId !== task.contextId)) unavailable();
    if (latest) submissionSnapshot(s, p, latest, clock);
    const source = campaignRequestSource(s, request);
    if (!requestRequirementsValid(request.data.content, source?.noMaterials === true)) return { kind: 'brand_submission' as const, taskStatus: task.data.status, sourceAvailable: false, required: false, remaining: 0, participation: 'ordinary' as const };
    const evaluation = safeEvaluation(request.data.content, latest?.data.answers ?? [], old?.data.content ?? request.data.content, !!latest, source?.noMaterials === true);
    return { kind: 'brand_submission' as const, taskStatus: task.data.status, sourceAvailable: true, required: evaluation.required > 0, remaining: evaluation.missing, participation: 'ordinary' as const };
}
export function taskSchedules(s: UnitOfWork, principal: Principal, taskId: string, clock: Clock): SourceSchedule[] {
    const task = sourceTask(s, principal, taskId, clock), p = currentActor(s, principal, task.contextId!, clock);
    if (task.data.schemaVersion !== 2 || task.data.visibility !== 'public' || !task.data.currentRequestId) return [];
    const request = s.get('requestVersion', task.data.currentRequestId);
    if (!request || request.data.taskId !== task.id || request.contextId !== task.contextId) unavailable();
    const base = { contextId: task.contextId!, taskId: task.id, title: sourceText(request.data.content.title), sourceRevision: request.revision, actionUrl: taskActionUrl(task.id, task.contextId!), active: true, unresolvedConflict: false };
    const need = currentSubmissionNeed(s, p, task, request, clock);
    const result: SourceSchedule[] = [{ ...base, logicalKey: `task:${task.id}:submission`, kind: 'submission', source: { kind: 'task_request', targetId: task.id, versionId: request.id, itemKey: 'deadline' }, deadline: sourceDeadline(request.data.content.deadline), visibility: 'public', need, ...recipientFacts(p, brandRecipientIds(s, task)), reminderSupport: 'current_need' }];
    for (const m of request.data.content.milestones) {
        if (m.visibility !== 'public' && m.visibility !== 'internal') unavailable();
        if (m.visibility === 'internal' && p.user.data.role !== 'gsg') continue;
        result.push({ ...base, logicalKey: `task:${task.id}:milestone:${m.id}`, kind: m.kind, source: { kind: 'task_milestone', targetId: task.id, versionId: request.id, itemKey: sourceText(m.id) }, deadline: sourceDeadline(m.deadline), visibility: m.visibility, nextAction: '외부 일정 진행 확인', need: { kind: 'responsible_action', taskStatus: task.data.status, sourceAvailable: true, pending: true }, ...recipientFacts(p, activeRecipientIds(s, task.contextId!, [m.deadline.responsibleUserId], 'gsg')), reminderSupport: 'current_need' });
    }
    return result;
}
export function campaignSchedules(s: UnitOfWork, principal: Principal, campaignId: string, clock: Clock): SourceSchedule[] {
    const { row, task } = resolveCampaign(s, principal, campaignId, clock), p = currentActor(s, principal, task.contextId!, clock);
    if (!row.data.currentVersionId) return [];
    const v = s.get('campaignVersion', row.data.currentVersionId); if (!v || v.data.campaignId !== row.id || v.contextId !== task.contextId) unavailable();
    // Existing version projection checks current original files/products AND campaign references.
    const content = versionDTO(s, p, v, clock), result: SourceSchedule[] = [];
    for (const menu of content.menus) {
        const state = menuProgress(s, p, v, menu, clock), key = menuIdentityKey(menu.identity);
        const base = { contextId: task.contextId!, taskId: task.id, title: sourceText(menu.identity.menuName), sourceRevision: v.revision, visibility: 'public' as const, actionUrl: `/tasks/${encodeURIComponent(task.id)}/campaigns?context=${encodeURIComponent(task.contextId!)}`, active: state.active, unresolvedConflict: menu.confirmationIssues.some(i => i.state === 'needs_confirmation') };
        const rows = [
            { key: 'request', kind: 'submission', deadline: menu.request.deadline },
            ...menu.request.milestones.filter(m => m.visibility === 'public' || p.user.data.role === 'gsg').map(m => ({ key: `milestone:${m.id}`, kind: m.kind, deadline: m.deadline })),
            ...menu.conditions.schedules.map(x => ({ key: `condition:${x.key}`, kind: x.kind, deadline: x.deadline })),
            ...menu.physical.flatMap(x => [{ key: `physical:${x.key}:ship`, kind: 'shipping', deadline: x.plannedShip }, { key: `physical:${x.key}:arrival`, kind: 'arrival', deadline: x.plannedArrival }]),
            ...menu.followups.map(x => ({ key: `followup:${x.key}`, kind: x.kind, deadline: x.deadline })),
        ];
        for (const item of rows) {
            // Canonical task submission owns brand reminders. Operational observations are
            // separate GSG next actions; recorded dispatch/receipt is never inferred fulfillment.
            let pending = true, nextAction = '행사 일정 진행 확인';
            if (item.kind === 'application') { pending = state.state.application === 'not_applied'; nextAction = '외부 신청 확인'; }
            if (item.kind === 'review') { pending = state.state.selection === 'pending'; nextAction = '외부 검토 결과 확인'; }
            if (item.kind === 'publication_use') { pending = state.state.execution !== 'finished'; nextAction = '게시·사용 진행 확인'; }
            for (const physical of state.physical) {
                if (item.key === `physical:${physical.definition.key}:ship`) { pending = physical.facts.every(f => f.kind !== 'dispatch'); nextAction = '발송 기록 확인 · 수령과 별도'; }
                if (item.key === `physical:${physical.definition.key}:arrival`) { pending = physical.receiptFacts === 0; nextAction = '수령 관측 확인 · 이행 완료 추정 없음'; }
            }
            for (const followup of state.followups) if (item.key === `followup:${followup.definition.key}`) { pending = followup.status === 'pending'; nextAction = '행사 후속 자료 수령 확인'; }
            const duplicateSubmission = item.key === 'request';
            result.push({ ...base, logicalKey: `campaign:${row.id}:${key}:${item.key}`, kind: item.kind, source: { kind: 'campaign', targetId: row.id, versionId: v.id, itemKey: `${key}:${item.key}` }, deadline: sourceDeadline(item.deadline), nextAction: duplicateSubmission ? '업무의 현재 제출 요청에서 안내' : nextAction, need: duplicateSubmission ? null : { kind: 'responsible_action', taskStatus: task.data.status, sourceAvailable: true, pending }, ...recipientFacts(p, activeRecipientIds(s, task.contextId!, [item.deadline.responsibleUserId], 'gsg')), reminderSupport: duplicateSubmission ? 'source_schedule_only' : 'current_need' });
        }
    }
    return result;
}
export function inquirySchedules(s: UnitOfWork, principal: Principal, conversationId: string, clock: Clock): SourceSchedule[] {
    const { row } = activeInquiry(s, principal, conversationId, clock), p = currentActor(s, principal, row.contextId!, clock);
    if (p.user.data.role !== 'gsg') return []; // External confirmation belongs to GSG, never a brand nag.
    const currentStaff = staff(s, row.contextId!);
    return questions(s, row).flatMap(q => {
        const e = q.data.externalWait; if (q.data.state !== 'external_waiting' || !e) return [];
        const ids = currentStaff.some(u => u.id === e.responsibleUserId) ? [e.responsibleUserId] : [];
        return [{ logicalKey: `inquiry:${row.id}:question:${q.id}`, contextId: row.contextId!, taskId: null, title: sourceText(row.data.title), kind: 'external_check', source: { kind: 'inquiry_external' as const, targetId: row.id, versionId: null, itemKey: q.id }, sourceRevision: q.revision, deadline: sourceDeadline({ value: e.nextCheckDate, precision: 'date', timezone: e.timezone, certainty: 'requested', source: '문의 외부 확인 예정', sourceVersion: `question:${q.id}:revision:${q.revision}`, responsibleUserId: e.responsibleUserId, raw: e.nextCheckDate }), visibility: 'internal' as const, actionUrl: `/inquiries/${encodeURIComponent(row.id)}?context=${encodeURIComponent(row.contextId!)}`, unresolvedConflict: false, active: true, need: { kind: 'gsg_external_check' as const, sourceAvailable: true, state: 'external_waiting' as const }, ...recipientFacts(p, ids), reminderSupport: 'current_need' as const }];
    });
}
