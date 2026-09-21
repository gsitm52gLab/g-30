import type { ScheduleContent } from '@/domain/scheduling/types';
import type { ScheduleState } from '@/domain/scheduling/records';
import { scheduleContent } from '@/domain/scheduling/validate';
import { unavailable, fail } from '@/server/auth/errors';
import { sourceDeadline } from './projection';
export function storedContent(value: ScheduleContent): ScheduleContent {
    try { return scheduleContent({ taskId: value.taskId, title: value.title, kind: value.kind, visibility: value.visibility, deadline: sourceDeadline(value.deadline), statements: value.statements.map(s => ({ id: s.id, raw: s.raw, source: s.source, version: s.version, locator: s.locator })), conflicts: value.conflicts.map(c => ({ id: c.id, statementIds: c.statementIds, state: c.state, resolution: c.resolution })) }); } catch { fail('SOURCE_INVALID', 503, '일정 원본을 확인해야 합니다.'); }
}
export function storedState(value: ScheduleState): ScheduleState { if (!['open', 'done', 'cancelled'].includes(value)) unavailable(); return value; }
