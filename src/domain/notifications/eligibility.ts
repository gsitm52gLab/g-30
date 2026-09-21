import { calendarPosition } from '@/domain/scheduling/calendar';
import type { ReminderDecision, ReminderFacts } from './types';

/** Pure business predicate only. The delivery UoW must resolve these facts again. */
export function reminderEligibility(facts: ReminderFacts, now: string): ReminderDecision {
    const { timing, need, recipient } = facts;
    if (!timing.active) return { eligible: false, reason: 'inactive_schedule' };
    if (!need.sourceAvailable) return { eligible: false, reason: 'source_unavailable' };
    if (need.kind === 'brand_submission') {
        if (['draft', 'completed', 'cancelled', 'on_hold'].includes(need.taskStatus)) return { eligible: false, reason: 'task_inactive' };
        if (!['ordinary', 'selected'].includes(need.participation)) return { eligible: false, reason: 'participation_inactive' };
        if (!need.required) return { eligible: false, reason: 'not_required' };
        if (!Number.isSafeInteger(need.remaining) || need.remaining < 0) return { eligible: false, reason: 'source_unavailable' };
        if (need.remaining === 0) return { eligible: false, reason: 'no_remaining' };
    } else if (need.state !== 'external_waiting') return { eligible: false, reason: 'external_wait_ended' };
    if (!recipient) return { eligible: false, reason: 'needs_assignment' };
    if (!recipient.active) return { eligible: false, reason: 'recipient_inactive' };
    if (!recipient.sourceReadable) return { eligible: false, reason: 'source_denied' };
    if (recipient.role !== (need.kind === 'brand_submission' ? 'brand' : 'gsg')) return { eligible: false, reason: 'wrong_recipient_role' };
    if (timing.unresolvedConflict) return { eligible: false, reason: 'unresolved_conflict' };
    const calendar = calendarPosition(timing.deadline, now);
    if (calendar.basis === 'undated') return { eligible: false, reason: 'undated' };
    if (calendar.basis === 'unconfirmed') return { eligible: false, reason: 'needs_confirmation' };
    if (!calendar.stage) return { eligible: false, reason: 'not_due' };
    return { eligible: true, recipientId: recipient.id, calendar };
}
