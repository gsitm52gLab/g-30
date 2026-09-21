import type { StoredRecord } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { NotificationEventFact, EventDisposition } from './types';
import { sourceText } from '@/server/scheduling/projection';

export function eventFact(event: StoredRecord<'domainEvent'>, p: Principal, targetKind: NotificationEventFact['source']['targetKind'], title: string, actionUrl: string, recipientIds: readonly string[], disposition?: EventDisposition): NotificationEventFact {
    const intended = recipientIds.includes(p.user.id);
    return { source: { eventId: event.id, contextId: event.contextId!, targetKind, targetId: sourceText(event.data.targetId), versionId: event.data.sourceVersionId === null ? null : sourceText(event.data.sourceVersionId) }, eventType: sourceText(event.data.eventType), occurredAt: sourceText(event.data.at), title: sourceText(title), actionUrl, actionPrecision: 'related_target', recipientId: intended ? p.user.id : null, disposition: disposition ?? (!recipientIds.length ? 'needs_assignment' : intended ? 'eligible' : 'other_recipient'), sourcePrecision: 'exact', certainty: null };
}
