import { describe, expect, it } from 'vitest';
import { blankContent } from '@/domain/tasks/types';
import { reminderEligibility } from '@/domain/notifications/eligibility';
import { eventRecipientKey, reminderDayKey } from '@/domain/notifications/keys';
import type { CurrentNeed, ReminderFacts } from '@/domain/notifications/types';

const now = '2026-09-21T08:00:00Z';
function facts(): ReminderFacts {
    return { timing: { active: true, unresolvedConflict: false, deadline: { ...blankContent().deadline, value: '2026-09-21', certainty: 'confirmed', responsibleUserId: 'brand-a' } }, need: { kind: 'brand_submission', taskStatus: 'partial', sourceAvailable: true, required: true, remaining: 1, participation: 'ordinary' }, recipient: { id: 'brand-a', role: 'brand', active: true, sourceReadable: true } };
}
function withNeed(patch: Partial<Extract<CurrentNeed, { kind: 'brand_submission' }>>): ReminderFacts { const f = facts(); return { ...f, need: { ...f.need as Extract<CurrentNeed, { kind: 'brand_submission' }>, ...patch } }; }
describe('G13 pure reminder predicates AC-13-04 A08/A18 SA-54 — no delivery or authorization proof', () => {
    it('keeps a current partially submitted required item eligible', () => {
        const f = facts(), before = JSON.stringify(f);
        expect(reminderEligibility(f, now)).toMatchObject({ eligible: true, recipientId: 'brand-a', calendar: { stage: 'due_today' } });
        expect(JSON.stringify(f)).toBe(before);
    });
    it.each(['draft', 'completed', 'cancelled', 'on_hold'] as const)('suppresses brand nag while task %s', taskStatus => {
        expect(reminderEligibility(withNeed({ taskStatus }), now)).toEqual({ eligible: false, reason: 'task_inactive' });
    });
    it.each(['unselected', 'declined', 'cancellation_discussion'] as const)('suppresses brand nag for %s while keeping external history outside this predicate', participation => {
        expect(reminderEligibility(withNeed({ participation }), now)).toEqual({ eligible: false, reason: 'participation_inactive' });
    });
    it('does not treat submitted task status alone as all current requirements fulfilled after request revision', () => {
        expect(reminderEligibility(withNeed({ taskStatus: 'submitted', remaining: 1 }), now).eligible).toBe(true);
        expect(reminderEligibility(withNeed({ taskStatus: 'partial', remaining: 0 }), now)).toEqual({ eligible: false, reason: 'no_remaining' });
        expect(reminderEligibility(withNeed({ required: false, remaining: 1 }), now)).toEqual({ eligible: false, reason: 'not_required' });
    });
    it.each([-1, NaN, 1.5])('fails closed for unavailable or invalid remaining count %s', remaining => {
        expect(reminderEligibility(withNeed({ remaining }), now)).toEqual({ eligible: false, reason: 'source_unavailable' });
    });
    it('requires current source facts rather than substituting unavailable with zero', () => {
        expect(reminderEligibility(withNeed({ sourceAvailable: false }), now)).toEqual({ eligible: false, reason: 'source_unavailable' });
    });
    it('rechecks current recipient and never assigns a fallback account', () => {
        const f = facts();
        expect(reminderEligibility({ ...f, recipient: null }, now)).toEqual({ eligible: false, reason: 'needs_assignment' });
        expect(reminderEligibility({ ...f, recipient: { ...f.recipient!, active: false } }, now)).toEqual({ eligible: false, reason: 'recipient_inactive' });
        expect(reminderEligibility({ ...f, recipient: { ...f.recipient!, sourceReadable: false } }, now)).toEqual({ eligible: false, reason: 'source_denied' });
        expect(reminderEligibility({ ...f, recipient: { ...f.recipient!, role: 'gsg' } }, now)).toEqual({ eligible: false, reason: 'wrong_recipient_role' });
    });
    it('routes external waiting checks only to current GSG and stops when wait ends', () => {
        const f: ReminderFacts = { ...facts(), need: { kind: 'gsg_external_check', sourceAvailable: true, state: 'external_waiting' } };
        expect(reminderEligibility(f, now)).toEqual({ eligible: false, reason: 'wrong_recipient_role' });
        const gsg = { ...f, recipient: { ...f.recipient!, id: 'gsg-a', role: 'gsg' as const } };
        expect(reminderEligibility(gsg, now)).toMatchObject({ eligible: true, recipientId: 'gsg-a' });
        expect(reminderEligibility({ ...gsg, need: { ...f.need, state: 'resolved' } as CurrentNeed }, now)).toEqual({ eligible: false, reason: 'external_wait_ended' });
    });
    it('suppresses unresolved date conflict and unconfirmed/undated/cancelled schedules', () => {
        const f = facts();
        expect(reminderEligibility({ ...f, timing: { ...f.timing, unresolvedConflict: true } }, now)).toEqual({ eligible: false, reason: 'unresolved_conflict' });
        expect(reminderEligibility({ ...f, timing: { ...f.timing, active: false } }, now)).toEqual({ eligible: false, reason: 'inactive_schedule' });
        expect(reminderEligibility({ ...f, timing: { ...f.timing, deadline: { ...f.timing.deadline, certainty: 'needs_confirmation' } } }, now)).toEqual({ eligible: false, reason: 'needs_confirmation' });
        expect(reminderEligibility({ ...f, timing: { ...f.timing, deadline: { ...f.timing.deadline, value: null } } }, now)).toEqual({ eligible: false, reason: 'undated' });
    });
    it('evaluates reopened task from current remaining need and only today, not historical catchup', () => {
        const reopened = withNeed({ taskStatus: 'requested', remaining: 1 });
        expect(reminderEligibility(reopened, '2026-09-25T08:00:00Z')).toMatchObject({ eligible: true, calendar: { localToday: '2026-09-25', stage: 'overdue', daysUntil: -4 } });
        expect(reminderEligibility(withNeed({ taskStatus: 'submitted', remaining: 0 }), now).eligible).toBe(false);
    });
});
describe('G13 canonical dedupe keys AC-13-03 SA-53 — uniqueness enforcement deferred to DB', () => {
    it('keeps event/recipient pair stable and separates distinct events and recipients', () => {
        expect(eventRecipientKey('event-a', 'user-a')).toBe(eventRecipientKey('event-a', 'user-a'));
        expect(new Set([eventRecipientKey('event-a', 'user-a'), eventRecipientKey('event-b', 'user-a'), eventRecipientKey('event-a', 'user-b')]).size).toBe(3);
        expect(eventRecipientKey('a-b', 'c')).not.toBe(eventRecipientKey('a', 'b-c'));
    });
    it('dedupes current local day without depending on mutable title/revision and separates day/stage/source', () => {
        const key = reminderDayKey('task-a:deadline', 'brand-a', '2026-09-21', 'overdue');
        expect(key).toBe(reminderDayKey('task-a:deadline', 'brand-a', '2026-09-21', 'overdue'));
        expect(new Set([key, reminderDayKey('task-a:deadline', 'brand-a', '2026-09-22', 'overdue'), reminderDayKey('task-a:deadline', 'brand-a', '2026-09-21', 'due_today'), reminderDayKey('task-b:deadline', 'brand-a', '2026-09-21', 'overdue')]).size).toBe(4);
        expect(() => reminderDayKey('task-a', 'brand-a', '2026-02-30', 'overdue')).toThrow();
    });
});
