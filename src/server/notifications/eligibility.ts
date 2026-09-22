import { reminderEligibility } from '@/domain/notifications/eligibility';
import type { SourceSchedule } from '@/server/scheduling/types';
/** Server facts must be resolved in the delivery transaction, not cached from this result. */
export function sourceReminderDecision(source: SourceSchedule, now: string) {
    if (source.reminderSupport !== 'current_need' || !source.need) return { eligible: false as const, reason: 'source_schedule_only' as const };
    if (source.recipientState === 'other_recipient') return { eligible: false as const, reason: 'other_recipient' as const };
    return reminderEligibility({ timing: { deadline: source.deadline, unresolvedConflict: source.unresolvedConflict, active: source.active }, need: source.need, recipient: source.recipient }, now);
}
