import type { Deadline } from '@/domain/tasks/types';
import { deadline } from '@/domain/tasks/validate';
import { projectedDeadline } from '@/server/tasks/projection';
import { fail } from '@/server/auth/errors';

export function sourceText(value: unknown, max = 200): string {
    if (typeof value !== 'string' || value.length > max) fail('STORAGE_UNAVAILABLE', 503, '원본 정보를 확인할 수 없습니다.');
    return value;
}
/** Explicit known fields only, then existing strict validation. Unknown stored keys stay stored. */
export function sourceDeadline(input: Deadline): Deadline {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORAGE_UNAVAILABLE', 503, '일정 원본을 확인할 수 없습니다.');
    try {
        const d = projectedDeadline(input);
        if (input.precision !== d.precision || input.certainty !== d.certainty || input.value !== d.value) throw Error('invalid stored deadline');
        return deadline(d);
    } catch { return fail('STORAGE_UNAVAILABLE', 503, '일정 원본을 확인할 수 없습니다.'); }
}
export const taskActionUrl = (id: string, contextId: string) => `/tasks/${encodeURIComponent(id)}?context=${encodeURIComponent(contextId)}`;
