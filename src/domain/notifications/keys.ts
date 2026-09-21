import { dateValue, ids } from '@/domain/tasks/validate';
import { enumValue, str } from '@/domain/tasks/validate';
import type { ReminderStage } from '@/domain/scheduling/types';

/** Canonical tuples for unique constraints; not an authorization or delivery receipt. */
export function eventRecipientKey(eventId: string, recipientId: string): string {
    return JSON.stringify(['event-recipient-v1', ids([eventId])[0], ids([recipientId])[0]]);
}
export function reminderDayKey(logicalSource: string, recipientId: string, localDay: string, stage: ReminderStage): string {
    return JSON.stringify(['reminder-day-v1', str(logicalSource, 1000, true), ids([recipientId])[0], dateValue(localDay), enumValue(stage, ['two_days_before', 'due_today', 'overdue'] as const)]);
}
