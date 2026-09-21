import { object, str, enumValue } from '../tasks/validate';
import { fail } from '@/server/auth/errors';
import type { PreviewInput } from './types';
export function integer(value: unknown, min = 1, max = 1000000) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail('VALIDATION', 422, '정수 범위를 확인해 주세요.'); return value; }
export function previewInput(value: unknown): PreviewInput {
    const v = object(value, ['sourceId', 'sheetId', 'headerRow', 'mapping', 'choices']);
    if (!Array.isArray(v.mapping) || !Array.isArray(v.choices) || v.mapping.length > 100 || v.choices.length > 5000)
        fail('VALIDATION', 422, '열 매핑과 행 선택을 확인해 주세요.');
    return { sourceId: str(v.sourceId, 160, true), sheetId: integer(v.sheetId), headerRow: integer(v.headerRow), mapping: v.mapping.map(raw => { const m = object(raw, ['column', 'field']); return { column: integer(m.column, 1, 100), field: str(m.field, 100, true) }; }), choices: v.choices.map(raw => { const c = object(raw, ['row', 'action', 'clearFields']); if (!Array.isArray(c.clearFields) || c.clearFields.length > 100)
            fail('VALIDATION', 422, '비울 필드를 확인해 주세요.'); return { row: integer(c.row), action: enumValue(c.action, ['new', 'update', 'skip']), clearFields: c.clearFields.map(x => str(x, 100, true)) }; }) };
}
