import type { TaskData } from '@/domain/records';
import type { CalendarPosition, ScheduleTiming } from '@/domain/scheduling/types';

/** Trusted, freshly resolved facts from a future server adapter, never client grants. */
export interface CurrentRecipient {
    id: string;
    role: 'gsg' | 'brand';
    active: boolean;
    sourceReadable: boolean;
}
export type CurrentNeed =
    { kind: 'brand_submission'; taskStatus: TaskData['status']; sourceAvailable: boolean; required: boolean; remaining: number; participation: 'ordinary' | 'selected' | 'unselected' | 'declined' | 'cancellation_discussion' } |
    { kind: 'gsg_external_check'; sourceAvailable: boolean; state: 'external_waiting' | 'resolved' | 'other' };
export type SuppressionReason = 'inactive_schedule' | 'source_unavailable' | 'task_inactive' | 'not_required' | 'no_remaining' | 'participation_inactive' | 'external_wait_ended' | 'needs_assignment' | 'recipient_inactive' | 'source_denied' | 'wrong_recipient_role' | 'unresolved_conflict' | 'undated' | 'needs_confirmation' | 'not_due';
export type ReminderDecision = { eligible: true; recipientId: string; calendar: CalendarPosition } | { eligible: false; reason: SuppressionReason };
export interface ReminderFacts { timing: ScheduleTiming; need: CurrentNeed; recipient: CurrentRecipient | null }
export interface NotificationSource {
    eventId: string;
    contextId: string;
    targetKind: 'task' | 'notice' | 'inquiry' | 'campaign' | 'schedule';
    targetId: string;
    versionId: string | null;
}
/** Delivery, read state and external transport are independent facts. */
export interface NotificationStatus {
    inApp: 'pending' | 'delivered' | 'failed' | 'suppressed';
    readAt: string | null;
    email: 'not_connected';
}
