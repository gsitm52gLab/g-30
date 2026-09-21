import { createHash } from 'node:crypto';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { DeliverySource } from '@/domain/notifications/records';
import { eventRecipientKey, reminderDayKey } from '@/domain/notifications/keys';
import { object, ids, str, enumValue, dateValue } from '@/domain/tasks/validate';
import { unavailable } from '@/server/auth/errors';
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { scheduleSources } from '@/server/scheduling/read';
import { manualSchedule } from '@/server/scheduling/manual';
import { sourceTask } from '@/server/scheduling/access';
import { versionDTO as campaignVersion } from '@/server/campaigns/projection';
import { resolveCampaign } from '@/server/campaigns/access';
import { canReferenceFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { notificationEventSource } from './sources';
import { sourceReminderDecision } from './eligibility';

export const deliveryId = (key: string) => createHash('sha256').update(key).digest('hex');
export function deliveryKey(source: DeliverySource, recipientId: string) { return source.kind === 'event' ? eventRecipientKey(source.eventId, recipientId) : reminderDayKey(source.logicalKey, recipientId, source.localDay, source.stage); }
export function projectedSource(input: DeliverySource): DeliverySource {
    // Explicit projection allows stored extension keys without ever spreading them.
    if (input.kind === 'event') return { kind: 'event', eventId: ids([input.eventId])[0] };
    if (input.kind !== 'reminder') unavailable();
    const s = input.source; if (!s) unavailable();
    return { kind: 'reminder', logicalKey: str(input.logicalKey, 1000, true), localDay: dateValue(input.localDay), stage: enumValue(input.stage, ['two_days_before', 'due_today', 'overdue'] as const), source: { kind: enumValue(s.kind, ['manual', 'task_request', 'task_milestone', 'campaign', 'inquiry_external'] as const), targetId: ids([s.targetId])[0], versionId: s.versionId === null ? null : ids([s.versionId])[0], itemKey: str(s.itemKey, 1000, true) } };
}
function reminderOrigin(s: UnitOfWork, p: Principal, source: Extract<DeliverySource, { kind: 'reminder' }>, clock: Clock) {
    const x = source.source;
    if (x.kind === 'manual') { if (!x.versionId) unavailable(); manualSchedule(s, p, x.targetId, clock, x.versionId); }
    if (x.kind === 'campaign') {
        const { row } = resolveCampaign(s, p, x.targetId, clock), v = x.versionId ? s.get('campaignVersion', x.versionId) : null;
        if (!v || v.contextId !== row.contextId || v.data.campaignId !== row.id) unavailable(); campaignVersion(s, p, v, clock);
    }
    if (x.kind === 'task_request' || x.kind === 'task_milestone') {
        const t = sourceTask(s, p, x.targetId, clock), v = x.versionId ? s.get('requestVersion', x.versionId) : null;
        if (!v || v.data.taskId !== t.id || v.contextId !== t.contextId) unavailable();
        for (const id of v.data.content.referenceFileIds) { const file = s.get('fileVersion', id); if (!file) unavailable(); canReferenceFile(s, p, file, taskScope(t), clock); }
    }
}
export function resolvedDelivery(s: UnitOfWork, p: Principal, contextId: string, raw: DeliverySource, clock: Clock, delivering: boolean) {
    const source = projectedSource(raw);
    if (source.kind === 'event') {
        const fact = notificationEventSource(s, p, source.eventId, clock);
        if (fact.source.contextId !== contextId || fact.recipientId !== p.user.id || delivering && fact.disposition !== 'eligible') return null;
        if (!['eligible', 'superseded'].includes(fact.disposition)) return null;
        return { source, key: deliveryKey(source, p.user.id), title: fact.title, message: fact.eventType === 'TASK_SCHEDULE_CHANGE_REQUESTED' ? '일정 조정 요청을 확인해 주세요.' : '관련 업무의 새 공개 내용을 확인해 주세요.', actionUrl: fact.actionUrl, occurredAt: fact.occurredAt, certainty: fact.certainty };
    }
    const row = scheduleSources(s, p, contextId, clock).find(r => r.logicalKey === source.logicalKey);
    if (!row || row.recipient?.id !== p.user.id || row.source.kind !== source.source.kind || row.source.targetId !== source.source.targetId || row.source.itemKey !== source.source.itemKey) return null;
    reminderOrigin(s, p, source, clock);
    const decision = sourceReminderDecision(row, clock());
    if (delivering && (!decision.eligible || decision.calendar.localToday !== source.localDay || decision.calendar.stage !== source.stage || row.source.versionId !== source.source.versionId)) return null;
    const tentative = row.deadline.certainty !== 'confirmed' ? '요청·예상 일정' : '확정 일정';
    return { source, key: deliveryKey(source, p.user.id), title: row.title, message: `${tentative} · ${source.stage === 'two_days_before' ? '2일 전' : source.stage === 'due_today' ? '오늘' : '기한 경과'} · ${row.nextAction ?? (row.need?.kind === 'brand_submission' ? '남은 필수 자료 확인' : '진행 확인')}`, actionUrl: row.actionUrl, occurredAt: clock(), certainty: row.deadline.certainty };
}
/** Only a publication pair has the same semantic origin. Selection/other facts are distinct. */
export function canonicalEvent(s: UnitOfWork, source: DeliverySource): string | null {
    if (source.kind !== 'event') return null;
    const e = s.get('domainEvent', source.eventId); if (!e) unavailable();
    if (e.data.eventType === 'CAMPAIGN_PUBLISHED') return e.id;
    if (e.data.eventType !== 'TASK_REQUEST_REVISED' || !e.data.sourceVersionId) return null;
    const request = s.get('requestVersion', e.data.sourceVersionId); if (!request || request.data.taskId !== e.data.targetId || request.contextId !== e.contextId) unavailable();
    const origin = campaignRequestSource(s, request);
    if (!origin || origin.selectionVersionId || origin.sourceFactId) return null;
    return s.list('domainEvent', e.contextId!).find(v => v.data.eventType === 'CAMPAIGN_PUBLISHED' && v.data.targetId === origin.campaignId && v.data.sourceVersionId === origin.campaignVersionId)?.id ?? null;
}
export function readCommand(input: unknown) { const x = object(input, ['read', 'expectedRevision', 'idempotencyKey']); if (typeof x.read !== 'boolean') unavailable(); return { ...x, read: x.read }; }
