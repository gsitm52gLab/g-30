import { deadline, enumValue, ids, list, object, str } from '@/domain/tasks/validate';
import { fail } from '@/server/auth/errors';
import { scheduleKinds, type ScheduleContent } from './types';

function originalText(value: unknown): string { str(value, 4000, true); return value as string; }

/** Reuses the existing Deadline contract; no store or current-authority assumptions. */
export function scheduleContent(input: unknown): ScheduleContent {
    const v = object(input, ['taskId', 'title', 'kind', 'visibility', 'deadline', 'statements', 'conflicts']);
    const statements = list(v.statements, 40).map(value => {
        const s = object(value, ['id', 'raw', 'source', 'version', 'locator']);
        return { id: ids([s.id])[0], raw: originalText(s.raw), source: str(s.source, 1000, true), version: str(s.version, 200), locator: str(s.locator, 500) };
    });
    if (new Set(statements.map(s => s.id)).size !== statements.length) fail('VALIDATION', 422, '원문 식별자가 중복됩니다.');
    const conflicts = list(v.conflicts, 20).map(value => {
        const c = object(value, ['id', 'statementIds', 'state', 'resolution']);
        const statementIds = ids(c.statementIds, 40), state = enumValue(c.state, ['unresolved', 'resolved'] as const);
        if (statementIds.length < 2 || statementIds.some(id => !statements.some(s => s.id === id))) fail('VALIDATION', 422, '충돌하는 원문을 둘 이상 정확히 연결해 주세요.');
        return { id: ids([c.id])[0], statementIds, state, resolution: str(c.resolution, 2000, state === 'resolved') };
    });
    if (new Set(conflicts.map(c => c.id)).size !== conflicts.length) fail('VALIDATION', 422, '충돌 식별자가 중복됩니다.');
    return { taskId: ids([v.taskId])[0], title: str(v.title, 200, true), kind: enumValue(v.kind, scheduleKinds), visibility: enumValue(v.visibility, ['public', 'internal'] as const), deadline: deadline(v.deadline), statements, conflicts };
}
