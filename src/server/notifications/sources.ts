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
export async function notificationEventSource(s: UnitOfWork, principal: Principal, eventId: string, clock: Clock): Promise<NotificationEventFact> {
    const event = (await s.get('domainEvent', eventId));
    if (!event?.contextId)
        unavailable();
    const p = (await currentActor(s, principal, event.contextId, clock)), { eventType: type, targetId, sourceVersionId: versionId } = event.data;
    if (type === 'SCHEDULE_CHANGED') {
        if (!versionId)
            unavailable();
        const v = (await manualSchedule(s, p, targetId, clock, versionId));
        if (v.row.contextId !== event.contextId || v.content.visibility !== 'public')
            unavailable();
        return { ...eventFact(event, p, 'schedule', v.content.title, v.source.actionUrl, v.source.recipient ? [v.source.recipient.id] : [], v.version.id !== v.row.data.currentVersionId ? 'superseded' : v.source.recipientState === 'other_recipient' ? 'other_recipient' : undefined), certainty: v.content.deadline.certainty };
    }
    if (type.startsWith('NOTICE_')) {
        if (!['NOTICE_PUBLISHED', 'NOTICE_REVISED'].includes(type) || !versionId)
            unavailable();
        const { notice, version } = (await resolveNotice(s, p, targetId, clock, false, versionId));
        if (!version || notice.contextId !== event.contextId)
            unavailable();
        const dto = (await noticeVersion(s, p, notice, version, clock));
        const recipients = p.user.data.role === 'brand' && version.data.publishedRecipientUserIds.includes(p.user.id) ? [p.user.id] : [];
        return { ...eventFact(event, p, 'notice', dto.content.title, `/notices/${encodeURIComponent(notice.id)}?context=${encodeURIComponent(event.contextId)}&version=${encodeURIComponent(version.id)}`, recipients, notice.data.currentVersionId !== version.id ? 'superseded' : recipients.length ? undefined : 'other_recipient'), actionPrecision: 'exact_version' };
    }
    if (type.startsWith('INQUIRY_')) {
        const { row } = (await activeInquiry(s, p, targetId, clock));
        if (row.contextId !== event.contextId)
            unavailable();
        const url = `/inquiries/${encodeURIComponent(row.id)}?context=${encodeURIComponent(event.contextId)}`;
        if (['INQUIRY_STATE', 'INQUIRY_LINK_TASK'].includes(type)) {
            if (type === 'INQUIRY_STATE') {
                const q = versionId ? (await s.get('inquiryQuestion', versionId)) : null;
                if (!q || q.contextId !== row.contextId || q.data.conversationId !== row.id)
                    unavailable();
                (await questionDTO(s, p, q, row));
            }
            return { ...eventFact(event, p, 'inquiry', sourceText(row.data.title), url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
        }
        if (!['INQUIRY_PUBLISH_FIRST', 'INQUIRY_QUESTION', 'INQUIRY_SUPPLEMENT', 'INQUIRY_ANSWER', 'INQUIRY_MESSAGE'].includes(type))
            return eventFact(event, p, 'inquiry', sourceText(row.data.title), url, [], 'unsupported');
        const message = versionId ? (await s.get('inquiryMessage', versionId)) : null;
        if (!message || message.data.visibility !== 'public' || message.contextId !== row.contextId || message.data.conversationId !== row.id)
            unavailable();
        const dto = (await messageDTO(s, p, message, row, clock)); // Includes actual original AND reference file authorization.
        const questionKinds = ['question', 'supplement'], answerKinds = ['answer', 'acknowledgement'];
        let recipients: string[] = [];
        if (questionKinds.includes(dto.kind) || dto.kind === 'comment' && message.data.authorId === row.data.initiatorId) {
            const task = row.data.taskId ? (await sourceTask(s, p, row.data.taskId, clock)) : null;
            recipients = task ? (await ownerRecipientIds(s, task)) : (await staff(s, row.contextId!)).map(u => u.id);
        }
        else if (answerKinds.includes(dto.kind) || dto.kind === 'comment')
            recipients = (await activeRecipientIds(s, row.contextId!, [row.data.initiatorId], 'brand'));
        return eventFact(event, p, 'inquiry', sourceText(row.data.title), url, recipients);
    }
    if (type.startsWith('CAMPAIGN_')) {
        const { row, task } = (await resolveCampaign(s, p, targetId, clock));
        if (row.contextId !== event.contextId)
            unavailable();
        const url = `/tasks/${encodeURIComponent(task.id)}/campaigns?context=${encodeURIComponent(event.contextId)}`;
        if (type === 'CAMPAIGN_PUBLISHED') {
            const v = versionId ? (await s.get('campaignVersion', versionId)) : null;
            if (!v || v.data.campaignId !== row.id || v.contextId !== event.contextId)
                unavailable();
            const dto = (await campaignVersion(s, p, v, clock));
            return eventFact(event, p, 'campaign', dto.title, url, (await brandRecipientIds(s, task)), row.data.currentVersionId !== v.id ? 'superseded' : undefined);
        }
        if (type === 'CAMPAIGN_SELECTION_RECORDED') {
            const v = versionId ? (await s.get('campaignSelection', versionId)) : null;
            if (!v || v.data.campaignId !== row.id || v.contextId !== event.contextId)
                unavailable();
            const version = (await s.get('campaignVersion', v.data.campaignVersionId));
            if (!version || version.data.campaignId !== row.id)
                unavailable();
            (await campaignVersion(s, p, version, clock));
            (await selectionDTO(s, p, v));
            return eventFact(event, p, 'campaign', sourceText(task.data.title), url, (await ownerRecipientIds(s, task)));
        }
        if (type === 'CAMPAIGN_FACT_RECORDED') {
            const fact = versionId ? (await s.get('campaignExternalFact', versionId)) ?? (await s.get('campaignPhysicalFact', versionId)) ?? (await s.get('campaignFollowupFact', versionId)) : null;
            if (!fact || fact.contextId !== row.contextId || fact.data.campaignId !== row.id)
                unavailable();
            (await campaignDetail(s, p, row.id, clock, fact.data.campaignVersionId));
            return { ...eventFact(event, p, 'campaign', sourceText(task.data.title), url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
        }
        return eventFact(event, p, 'campaign', sourceText(task.data.title), url, [], 'unsupported');
    }
    const task = (await sourceTask(s, p, targetId, clock));
    if (task.contextId !== event.contextId)
        unavailable();
    const title = sourceText(task.data.title), url = taskActionUrl(task.id, event.contextId);
    const brand = (await brandRecipientIds(s, task)), owner = (await ownerRecipientIds(s, task));
    if (['TASK_PUBLISHED', 'TASK_REQUEST_REVISED', 'TASK_ASSIGNMENT_CHANGED', 'TASK_ACCEPTED', 'TASK_SCHEDULE_CHANGE_REQUESTED'].includes(type)) {
        const activity = type === 'TASK_SCHEDULE_CHANGE_REQUESTED' && versionId ? (await s.get('taskActivity', versionId)) : null;
        const requestId = activity?.data.requestId ?? versionId, request = requestId ? (await s.get('requestVersion', requestId)) : null;
        if (!request || request.data.taskId !== task.id || request.contextId !== event.contextId || task.data.visibility !== 'public')
            unavailable();
        if (activity && (activity.data.taskId !== task.id || activity.contextId !== event.contextId || activity.data.kind !== 'schedule'))
            unavailable();
        (await campaignRequestSource(s, request)); // Validate immutable provenance; a related event is not proof of recipient-level delivery.
        // Canonical-alert dedupe belongs to delivery after the same origin AND current recipient are established.
        const disposition = request.id !== task.data.currentRequestId ? 'superseded' : undefined;
        const dto = eventFact(event, p, 'task', title, url, ['TASK_ACCEPTED', 'TASK_SCHEDULE_CHANGE_REQUESTED'].includes(type) ? owner : brand, disposition);
        return { ...dto, sourcePrecision: type === 'TASK_SCHEDULE_CHANGE_REQUESTED' && !activity ? 'activity_unavailable' : 'exact', certainty: sourceDeadline(activity?.data.proposedDeadline ?? request.data.content.deadline).certainty };
    }
    if (type === 'TASK_SUBMITTED') {
        const sub = versionId ? (await s.get('submission', versionId)) : null;
        if (!sub || sub.data.taskId !== task.id || sub.contextId !== event.contextId)
            unavailable();
        (await submissionSnapshot(s, p, sub, clock));
        return eventFact(event, p, 'task', title, url, owner);
    }
    if (type === 'CORRECTION_BATCH_PUBLISHED') {
        const batch = versionId ? (await s.get('correctionBatch', versionId)) : null;
        if (!batch || batch.data.taskId !== task.id || batch.contextId !== event.contextId)
            unavailable();
        const dto = (await batchDTO(s, p, batch, clock));
        return eventFact(event, p, 'task', dto.title, `/tasks/${encodeURIComponent(task.id)}/corrections?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (['CORRECTION_ITEM_REFLECTED', 'CORRECTION_ITEM_RESOLVED'].includes(type)) {
        const row = versionId ? type === 'CORRECTION_ITEM_REFLECTED' ? (await s.get('correctionReflection', versionId)) : (await s.get('correctionResolution', versionId)) : null;
        if (!row || row.contextId !== task.contextId || row.data.taskId !== task.id)
            unavailable();
        const batch = (await s.get('correctionBatch', row.data.batchVersionId));
        if (!batch || batch.data.taskId !== task.id)
            unavailable();
        (await batchDTO(s, p, batch, clock));
        return { ...eventFact(event, p, 'task', title, url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
    }
    if (['TASK_HOLD', 'TASK_CANCEL', 'TASK_RESUME'].includes(type)) {
        const request = versionId ? (await s.get('requestVersion', versionId)) : null;
        if (versionId && (!request || request.data.taskId !== task.id || request.contextId !== event.contextId))
            unavailable();
        return { ...eventFact(event, p, 'task', title, url, [], 'invalidation_only'), sourcePrecision: 'current_state_only' };
    }
    if (type === 'TASK_MANUALLY_COMPLETED') {
        const row = versionId ? (await s.get('completionSnapshot', versionId)) : null;
        if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId)
            unavailable();
        (await completionSnapshot(s, p, row, clock));
        return eventFact(event, p, 'task', title, `/tasks/${encodeURIComponent(task.id)}/completion?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (type === 'TASK_REOPENED') {
        const row = versionId ? (await s.get('completionReopen', versionId)) : null;
        if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId)
            unavailable();
        (await reopenDTO(s, p, row, clock));
        return eventFact(event, p, 'task', title, `/tasks/${encodeURIComponent(task.id)}/completion?context=${encodeURIComponent(event.contextId)}`, brand);
    }
    if (type === 'EXTERNAL_ACTION_RECORDED') {
        const row = versionId ? (await s.get('completionExternalAction', versionId)) : null;
        if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId)
            unavailable();
        (await externalDTO(s, p, row, clock));
        return eventFact(event, p, 'task', title, url, [], 'invalidation_only');
    }
    if (type === 'COMPLETION_FOLLOWUP_LINKED') {
        const row = versionId ? (await s.get('completionFollowup', versionId)) : null;
        if (!row || row.data.taskId !== task.id || row.contextId !== event.contextId || !(await followupDTO(s, p, row, clock)))
            unavailable();
        return eventFact(event, p, 'task', title, url, [], 'invalidation_only');
    }
    return eventFact(event, p, 'task', title, url, [], 'unsupported');
}
