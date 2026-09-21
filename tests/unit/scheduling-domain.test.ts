import { describe, expect, it } from 'vitest';
import { blankContent } from '@/domain/tasks/types';
import { calendarOrdinal, calendarPosition, explicitZonedInstant, localCalendarDay } from '@/domain/scheduling/calendar';
import { scheduleContent } from '@/domain/scheduling/validate';
import type { Deadline, ScheduleContent } from '@/domain/scheduling/types';

function due(overrides: Partial<Deadline> = {}): Deadline {
    return { ...blankContent().deadline, value: '2026-03-08', timezone: 'America/New_York', certainty: 'confirmed', responsibleUserId: 'staff-a', ...overrides };
}
function content(): ScheduleContent {
    return { taskId: 'task-a', title: '자료 제출', kind: 'submission', visibility: 'public', deadline: due(), statements: [{ id: 'mail', raw: '  3월 8일 (토)\n원문  ', source: '메일', version: 'v1', locator: '본문2행' }, { id: 'pdf', raw: '2026-03-09', source: '자료', version: 'v2', locator: 'p3' }], conflicts: [{ id: 'date', statementIds: ['mail', 'pdf'], state: 'unresolved', resolution: '' }] };
}
describe('G13 pure calendar AC-13-01 A17 SA-51/52', () => {
    it('uses D-2 local calendar across spring DST although actual noon instants are47h apart', () => {
        const now = '2026-03-06T12:00:00-05:00', deadline = due({ precision: 'datetime', value: '2026-03-08T12:00:00-04:00' });
        expect((Date.parse(deadline.value!) - Date.parse(now)) / 3_600_000).toBe(47);
        expect(calendarPosition(deadline, now)).toMatchObject({ localToday: '2026-03-06', dueDay: '2026-03-08', daysUntil: 2, stage: 'two_days_before', basis: 'confirmed' });
    });
    it('uses D-2 across autumn DST although actual instants are49h apart', () => {
        const now = '2026-10-30T12:00:00-04:00', deadline = due({ precision: 'datetime', value: '2026-11-01T12:00:00-05:00' });
        expect((Date.parse(deadline.value!) - Date.parse(now)) / 3_600_000).toBe(49);
        expect(calendarPosition(deadline, now).stage).toBe('two_days_before');
    });
    it.each([
        ['2026-09-21T15:00:00Z', 'Asia/Seoul', '2026-09-22'],
        ['2026-09-21T15:00:00Z', 'America/Los_Angeles', '2026-09-21'],
        ['2026-12-31T12:00:00Z', 'Pacific/Kiritimati', '2027-01-01'],
        ['2026-12-31T12:00:00Z', 'Etc/GMT+12', '2026-12-31'],
    ])('projects actual instant %s in %s onto source localday %s', (instant, timezone, expected) => {
        expect(localCalendarDay(instant, timezone)).toBe(expected);
    });
    it('keeps date-only independent from user/host timezone and adds no exact time', () => {
        const d = due({ value: '2026-09-23', timezone: 'Asia/Seoul' }), before = JSON.stringify(d);
        expect(calendarPosition(d, '2026-09-20T16:00:00Z')).toMatchObject({ localToday: '2026-09-21', dueDay: '2026-09-23', daysUntil: 2 });
        expect(JSON.stringify(d)).toBe(before); expect(d.value).toBe('2026-09-23');
    });
    it('accepts stored UTC instants with a different display timezone without inventing a conflict', () => {
        expect(calendarPosition(due({ value: '2026-09-23T00:00:00Z', precision: 'datetime', timezone: 'America/Los_Angeles' }), '2026-09-22T12:00:00Z')).toMatchObject({ dueDay: '2026-09-22', stage: 'due_today' });
    });
    it.each([
        ['2026-03-05T12:00:00-05:00', 3, null], ['2026-03-07T12:00:00-05:00', 1, null],
        ['2026-03-08T12:00:00-04:00', 0, 'due_today'], ['2026-03-12T12:00:00-04:00', -4, 'overdue'],
    ])('evaluates only today %s and never catches up past reminder days', (now, daysUntil, stage) => {
        expect(calendarPosition(due(), now)).toMatchObject({ daysUntil, stage });
    });
    it.each(['requested', 'expected'] as const)('keeps %s notices tentative', certainty => {
        expect(calendarPosition(due({ certainty }), '2026-03-08T12:00:00-04:00')).toMatchObject({ stage: 'due_today', certainty, basis: 'tentative' });
    });
    it('keeps unknown dates and confirmation-required dates out of confirmed reminders', () => {
        expect(calendarPosition(due({ value: null }), '2026-03-08T12:00:00-04:00')).toMatchObject({ stage: null, dueDay: null, basis: 'undated' });
        expect(calendarPosition(due({ certainty: 'needs_confirmation' }), '2026-03-08T12:00:00-04:00')).toMatchObject({ stage: null, dueDay: '2026-03-08', basis: 'unconfirmed' });
    });
    it('crosses leap-day and year boundaries by calendar, including pre100 years correctly', () => {
        expect(calendarOrdinal('2028-03-01') - calendarOrdinal('2028-02-28')).toBe(2);
        expect(calendarOrdinal('2027-01-01') - calendarOrdinal('2026-12-30')).toBe(2);
        expect(calendarOrdinal('0099-01-02') - calendarOrdinal('0099-01-01')).toBe(1);
    });
    it.each(['2026-02-30', '2026-13-01', '2026-00-12', '2026-01-01junk'])('rejects malformed calendar date %s without normalizing', day => expect(() => calendarOrdinal(day)).toThrow());
    it('rejects offset-free clocks and unknown timezone', () => {
        expect(() => localCalendarDay('2026-09-21T12:00:00', 'Asia/Seoul')).toThrow();
        expect(() => calendarPosition(due({ timezone: 'Not/AZone' }), '2026-09-21T12:00:00Z')).toThrow();
    });
    it('selects either real DST fold only with its explicit matching offset', () => {
        expect(explicitZonedInstant('2026-11-01T01:30', '-04:00', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
        expect(explicitZonedInstant('2026-11-01T01:30', '-05:00', 'America/New_York')).toBe('2026-11-01T06:30:00.000Z');
    });
    it('rejects a DST gap, offset mismatch and ambiguous offset omission', () => {
        expect(() => explicitZonedInstant('2026-03-08T02:30', '-05:00', 'America/New_York')).toThrow();
        expect(() => explicitZonedInstant('2026-11-01T01:30', '-06:00', 'America/New_York')).toThrow();
        expect(() => explicitZonedInstant('2026-11-01T01:30', '', 'America/New_York')).toThrow();
        expect(explicitZonedInstant('2026-09-21T12:30', '+05:45', 'Asia/Kathmandu')).toBe('2026-09-21T06:45:00.000Z');
    });
    it('preserves conflicting raw originals and independent source versions when resolution is recorded', () => {
        const before = content(), parsed = scheduleContent(before);
        expect(parsed.statements).toEqual(before.statements); expect(parsed.deadline).toEqual(before.deadline);
        const resolved = scheduleContent({ ...before, conflicts: [{ ...before.conflicts[0], state: 'resolved', resolution: '확인 결과 3월9일' }] });
        expect(resolved.statements).toEqual(before.statements); expect(before.conflicts[0].state).toBe('unresolved');
    });
    it('rejects unknown fields, missing conflict source and unrecorded resolution', () => {
        const c = content();
        expect(() => scheduleContent({ ...c, rawAdminGrant: true })).toThrow();
        expect(() => scheduleContent({ ...c, conflicts: [{ ...c.conflicts[0], statementIds: ['mail', 'absent'] }] })).toThrow();
        expect(() => scheduleContent({ ...c, conflicts: [{ ...c.conflicts[0], state: 'resolved' }] })).toThrow();
    });
});
