import { dateValue, deadline as parseDeadline } from '@/domain/tasks/validate';
import type { CalendarPosition, Deadline } from './types';

function dateParts(instant: string, timezone: string) {
    // Existing validation rejects invalid calendar dates and offset-free instants.
    parseDeadline({ value: instant, precision: 'datetime', timezone, certainty: 'confirmed', source: '', sourceVersion: '', responsibleUserId: 'clock', raw: '' });
    return new Intl.DateTimeFormat('en-CA', { calendar: 'gregory', numberingSystem: 'latn', timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
}
function part(parts: Intl.DateTimeFormatPart[], key: Intl.DateTimeFormatPartTypes) { return parts.find(p => p.type === key)!.value; }
export function localCalendarDay(instant: string, timezone: string): string {
    const parts = dateParts(instant, timezone);
    return `${part(parts, 'year').padStart(4, '0')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}
export function calendarOrdinal(day: string): number {
    return Date.parse(`${dateValue(day)}T00:00:00Z`) / 86_400_000;
}
/** Evaluate only the current local day, never emit a catch-up list of past days. */
export function calendarPosition(value: Deadline, now: string): CalendarPosition {
    const d = parseDeadline(value), localToday = localCalendarDay(now, d.timezone);
    const dueDay = d.value === null ? null : d.precision === 'date' ? d.value : localCalendarDay(d.value, d.timezone);
    const daysUntil = dueDay === null ? null : calendarOrdinal(dueDay) - calendarOrdinal(localToday);
    const basis = dueDay === null ? 'undated' : d.certainty === 'needs_confirmation' ? 'unconfirmed' : d.certainty === 'confirmed' ? 'confirmed' : 'tentative';
    const stage = basis === 'undated' || basis === 'unconfirmed' ? null : daysUntil === 2 ? 'two_days_before' : daysUntil === 0 ? 'due_today' : daysUntil !== null && daysUntil < 0 ? 'overdue' : null;
    return { localToday, dueDay, daysUntil, stage, certainty: d.certainty, basis };
}
/** For a normal local date/time form. The caller must supply an explicit offset.
 * A DST gap is rejected; a fold is selected only by its matching explicit offset.
 * Stored Deadline instants need not have an offset matching the display timezone.
 */
export function explicitZonedInstant(local: string, offset: string, timezone: string): string {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local) || !/^(Z|[+-]\d{2}:\d{2})$/.test(offset)) throw new RangeError('날짜·시각과 명시적인 시간대 오프셋을 입력해 주세요.');
    const input = `${local}${offset}`, parts = dateParts(input, timezone);
    const wall = `${part(parts, 'year').padStart(4, '0')}-${part(parts, 'month')}-${part(parts, 'day')}T${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')}`;
    if (wall !== (local.length === 16 ? `${local}:00` : local)) throw new RangeError('선택한 시간대에 존재하는 시각과 오프셋을 확인해 주세요.');
    return new Date(input).toISOString();
}
