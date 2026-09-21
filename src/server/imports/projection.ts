import type { StoredRecord } from '@/domain/records';
import { importFields } from '@/domain/imports/fields';
import { IMPORT_SCHEMA, type ImportAction } from '@/domain/imports/types';
import { fail } from '@/server/auth/errors';
function invalid(): never { return fail('STORAGE_UNAVAILABLE', 503, '배치 결과의 형식을 확인할 수 없습니다. 입력을 유지한 채 관리자에게 확인을 요청해 주세요.'); }
function text(value: unknown): string { if (typeof value !== 'string')
    invalid(); return value; }
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
/** Unknown stored extensions are omitted; corrupted authoritative result fields are never guessed. */
export function batchDTO(b: StoredRecord<'importBatch'>) {
    if (!Array.isArray(b.data.rows) || !Array.isArray(b.data.mapping))
        invalid();
    return { id: b.id, contextId: b.contextId!, appliedAt: text(b.data.appliedAt), sourceHash: text(b.data.sourceHash), sourceName: text(b.data.sourceName), schema: IMPORT_SCHEMA,
        rows: b.data.rows.map(r => {
            if (!r || !Number.isSafeInteger(r.row) || r.row < 1 || !['new', 'update', 'skip'].includes(r.action) || !Array.isArray(r.versionIds) || r.versionIds.some(id => typeof id !== 'string'))
                invalid();
            return { row: r.row, action: r.action as ImportAction, productId: nullable(r.productId), contextProductId: nullable(r.contextProductId), versionIds: r.versionIds.map(text) };
        }), mapping: b.data.mapping.map(m => { if (!m || !Number.isSafeInteger(m.column) || m.column < 1 || m.column > 100 || !importFields.some(f => f.key === m.field))
            invalid(); return { column: m.column, field: text(m.field) }; }) };
}
