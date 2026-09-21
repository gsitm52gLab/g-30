import { manualSchedule } from '@/server/scheduling/manual';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { currentActor, sourceTask, brandRecipientIds, ownerRecipientIds, activeRecipientIds } from '@/server/scheduling/access';
import { sourceText, sourceDeadline, taskActionUrl } from '@/server/scheduling/projection';
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { snapshotDTO as submissionSnapshot } from '@/server/submissions/read';
import { resolveNotice } from '@/server/notices/access';
import { versionDTO as noticeVersion } from '@/server/notices/projection';
import { activeInquiry, staff } from '@/server/inquiries/access';
import { messageDTO, questionDTO } from '@/server/inquiries/projection';
import { batchDTO } from '@/server/corrections/projection';
import { resolveCampaign } from '@/server/campaigns/access';
import { campaignDetail } from '@/server/campaigns/read';
import { versionDTO as campaignVersion, selectionDTO } from '@/server/campaigns/projection';
import { externalDTO, snapshotDTO as completionSnapshot, followupDTO, reopenDTO } from '@/server/completion/projection';
import { eventFact } from './projection';
import type { NotificationEventFact } from './types';

/** Read-only, same caller UoW. It neither writes notifications nor changes source read state. */
export function notificationEventSource(s: UnitOfWork, principal: Principal, eventId: string, clock: Clock): NotificationEventFact {
    const event = s.get('domainEvent', eventId); if (!event?.contextId) unavailable();
    const p = currentActor(s, principal, event.contextId, clock), { eventType: type, targetId, sourceVersionId: versionId } = event.data;
    if (type === 'SCHEDULE_CHANGED') {
        if (!versionId) unavailable();
        const v = manualSchedule(s, p, targetId, clock, versionId);
        if (v.row.contextId !== event.contextId || v.content.visibility !== 'public') unavailable();
        return { ...eventFact(event, p, 'schedule', v.content.title, v.source.actionUrl, v.source.recipient ? [v.source.recipient.id] : [], v.version.id !== v.row.data.currentVersionId ? 'superseded' : v.source.recipientState === 'other_recipient' ? 'other_recipient' : undefined), certainty: v.content.deadline.certainty };
    }
    if (type.startsWith('NOTICE_')) {
        if (!['NOTICE_PUBLISHED', 'NOTICE_REVISED'].includes(type) || !versionId) unavailable();
        const { notice, version } = resolveNotice(s, p, targetId, clock, false, versionId); if (!version || notice.contextId !== event.contextId) unavailable();
        const dto = noticeVersion(s, p, notice, version, clock);
        const recipients = p.user.data.role === 'brand' && version.data.publishedRecipientUserIds.includes(p.user.id) ? [p.user.id] : [];
        return { ...eventFact(event, p, 'notice', dto.content.title, `/notices/${encodeURIComponent(notice.id)}?context=${encodeURIComponent(event.contextId)}&version=${encodeURIComponent(version.id)}`, recipients, notice.data.currentVersionId !== version.id ? 'superseded' : recipients.length ? undefined : 'other_recipient'), actionPrecision: 'exact_version' };
    }
    if (type.startsWith('INQUIRY_')) {
        const { row } = activeInquiry(s, p, targetId, clock); if (row.contextId !== event.contextId) unavailable();
        const url = `/inquiries/${encodeURIComponent(row.id)}?context=${encodeURIComponent(event.contextId)}`;
        if (['INQUIRY_STATE', 'INQUIRY_LINK_TASK'].includes(type)) {
            if (type === 'INQUIRY_STATE') { const q = versionId ? s.get('inquiryQuestion', versionId) : null; if (!q || q.contextId !== row.contextId || q.data.conversationId !== row.id) unavailable(); questionDTO(s, p, q, row); }
            return { ...eventFact(event, p, 'inquiry', sourceText(row.data.title), url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
        }
        if (!['INQUIRY_PUBLISH_FIRST', 'INQUIRY_QUESTION', 'INQUIRY_SUPPLEMENT', 'INQUIRY_ANSWER', 'INQUIRY_MESSAGE'].includes(type)) return eventFact(event, p, 'inquiry', sourceText(row.data.title), url, [], 'unsupported');
        const message = versionId ? s.get('inquiryMessage', versionId) : null;
        if (!message || message.data.visibility !== 'public' || message.contextId !== row.contextId || message.data.conversationId !== row.id) unavailable();
        const dto = messageDTO(s, p, message, row, clock); // Includes actual original AND reference file authorization.
        const questionKinds = ['question', 'supplement'], answerKinds = ['answer', 'acknowledgement'];
        let recipients: string[] = [];
        if (questionKinds.includes(dto.kind) || dto.kind === 'comment' && message.data.authorId === row.data.initiatorId) {
            const task = row.data.taskId ? sourceTask(s, p, row.data.taskId, clock) : null;
            recipients = task ? ownerRecipientIds(s, task) : staff(s, row.contextId!).map(u => u.id);
        } else if (answerKinds.includes(dto.kind) || dto.kind === 'comment') recipients = activeRecipientIds(s, row.contextId!, [row.data.initiatorId], 'brand');
        return eventFact(event, p, 'inquiry', sourceText(row.data.title), url, recipients);
    }
    if (type.startsWith('CAMPAIGN_')) {
        const { row, task } = resolveCampaign(s, p, targetId, clock); if (row.contextId !== event.contextId) unavailable();
        const url = `/tasks/${encodeURIComponent(task.id)}/campaigns?context=${encodeURIComponent(event.contextId)}`;
        if (type === 'CAMPAIGN_PUBLISHED') {
            const v = versionId ? s.get('campaignVersion', versionId) : null; if (!v || v.data.campaignId !== row.id || v.contextId !== event.contextId) unavailable();
            const dto = campaignVersion(s, p, v, clock);
            return eventFact(event, p, 'campaign', dto.title, url, brandRecipientIds(s, task), row.data.currentVersionId !== v.id ? 'superseded' : undefined);
        }
        if (type === 'CAMPAIGN_SELECTION_RECORDED') {
            const v = versionId ? s.get('campaignSelection', versionId) : null; if (!v || v.data.campaignId !== row.id || v.contextId !== event.contextId) unavailable();
            const version = s.get('campaignVersion', v.data.campaignVersionId); if (!version || version.data.campaignId !== row.id) unavailable();
            campaignVersion(s, p, version, clock); selectionDTO(s, p, v);
            return eventFact(event, p, 'campaign', sourceText(task.data.title), url, ownerRecipientIds(s, task));
        }
        if (type === 'CAMPAIGN_FACT_RECORDED') {
            const fact = versionId ? s.get('campaignExternalFact', versionId) ?? s.get('campaignPhysicalFact', versionId) ?? s.get('campaignFollowupFact', versionId) : null;
            if (!fact || fact.contextId !== row.contextId || fact.data.campaignId !== row.id) unavailable();
            campaignDetail(s, p, row.id, clock, fact.data.campaignVersionId);
            return { ...eventFact(event, p, 'campaign', sourceText(task.data.title), url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
        }
        return eventFact(event, p, 'campaign', sourceText(task.data.title), url, [], 'unsupported');
    }
    const task = sourceTask(s, p, targetId, clock); if (task.contextId !== event.contextId) unavailable();
    const title = sourceText(task.data.title), url = taskActionUrl(task.id, event.contextId);
    const brand = brandRecipientIds(s, task), owner = ownerRecipientIds(s, task);
    if (['TASK_PUBLISHED', 'TASK_REQUEST_REVISED', 'TASK_ASSIGNMENT_CHANGED', 'TASK_ACCEPTED', 'TASK_SCHEDULE_CHANGE_REQUESTED'].includes(type)) {
        const activity = type === 'TASK_SCHEDULE_CHANGE_REQUESTED' && versionId ? s.get('taskActivity', versionId) : null;
        const requestId = activity?.data.requestId ?? versionId, request = requestId ? s.get('requestVersion', requestId) : null;
        if (!request || request.data.taskId !== task.id || request.contextId !== event.contextId || task.data.visibility !== 'public') unavailable();
        if (activity && (activity.data.taskId !== task.id || activity.contextId !== event.contextId || activity.data.kind !== 'schedule')) unavailable();
        campaignRequestSource(s, request); // Validate immutable provenance; a related event is not proof of recipient-level delivery.
        // Canonical-alert dedupe belongs to delivery after the same origin AND current recipient are established.
        const disposition = request.id !== task.data.currentRequestId ? 'superseded' : undefined;
        const dto = eventFact(event, p, 'task', title, url, ['TASK_ACCEPTED', 'TASK_SCHEDULE_CHANGE_REQUESTED'].includes(type) ? owner : brand, disposition);
        return { ...dto, sourcePrecision: type === 'TASK_SCHEDULE_CHANGE_REQUESTED' && !activity ? 'activity_unavailable' : 'exact', certainty: sourceDeadline(activity?.data.proposedDeadline ?? request.data.content.deadline).certainty };
    }
    if (type === 'TASK_SUBMITTED') {
        const sub = versionId ? s.get('submission', versionId) : null; if (!sub || sub.data.taskId !== task.id || sub.contextId !== event.contextId) unavailable();
        submissionSnapshot(s, p, sub, clock);
        return eventFact(event, p, 'task', title, url, owner);
    }
    if (type === 'CORRECTION_BATCH_PUBLISHED') {
        const batch = versionId ? s.get('correctionBatch', versionId) : null; if (!batch || batch.data.taskId !== task.id || batch.contextId !== event.contextId) unavailable();
        const dto = batchDTO(s, p, batch, clock);
        return eventFact(event, p, 'task', dto.title, `/tasks/${encodeURIComponent(task.id)}/corrections?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (['CORRECTION_ITEM_REFLECTED', 'CORRECTION_ITEM_RESOLVED'].includes(type)) {
        const row = versionId ? type === 'CORRECTION_ITEM_REFLECTED' ? s.get('correctionReflection', versionId) : s.get('correctionResolution', versionId) : null;
        if (!row || row.contextId !== task.contextId || row.data.taskId !== task.id) unavailable();
        const batch = s.get('correctionBatch', row.data.batchVersionId); if (!batch || batch.data.taskId !== task.id) unavailable(); batchDTO(s, p, batch, clock);
        return { ...eventFact(event, p, 'task', title, url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
    }
    if (['TASK_HOLD', 'TASK_CANCEL', 'TASK_RESUME'].includes(type)) {
        const request = versionId ? s.get('requestVersion', versionId) : null;
        if (versionId && (!request || request.data.taskId !== task.id || request.contextId !== event.contextId)) unavailable();
        return { ...eventFact(event, p, 'task', title, url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
    }
    if (type === 'TASK_MANUALLY_COMPLETED') {
        const row = versionId ? s.get('completionSnapshot', versionId) : null; if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId) unavailable();
        completionSnapshot(s, p, row, clock);
        return eventFact(event, p, 'task', title, `/tasks/${encodeURIComponent(task.id)}/completion?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (type === 'TASK_REOPENED') {
        const row = versionId ? s.get('completionReopen', versionId) : null; if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId) unavailable(); reopenDTO(s, p, row, clock);
        return eventFact(event, p, 'task', title, `/tasks/${encodeURIComponent(task.id)}/completion?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (type === 'EXTERNAL_ACTION_RECORDED') {
        const row = versionId ? s.get('completionExternalAction', versionId) : null; if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId) unavailable(); externalDTO(s, p, row, clock);
        return eventFact(event, p, 'task', title, url, [], 'invalidation_only');
    }
    if (type === 'COMPLETION_FOLLOWUP_LINKED') {
        const row = versionId ? s.get('completionFollowup', versionId) : null; if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId || !followupDTO(s, p, row, clock)) unavailable();
        return eventFact(event, p, 'task', title, url, [], 'invalidation_only');
    }
    return eventFact(event, p, 'task', title, url, [], 'unsupported');
}
