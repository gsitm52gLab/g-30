import type { RecordKind } from '@/domain/records';
/** Additive metadata only. Existing audit rows are never rewritten. */
export type AuditValue = string | number | boolean | null | string[];
export interface AuditReference {
    kind: RecordKind;
    id: string;
    role: 'before' | 'after' | 'source';
}
export interface AuditDetail {
    schemaVersion: 2;
    operationId: string;
    receiptId: string | null;
    subject: {
        kind: RecordKind;
        id: string;
    } | null;
    sensitivity: 'standard' | 'internal_price';
    references: AuditReference[];
    changes: {
        key: string;
        before: AuditValue;
        after: AuditValue;
    }[];
    sourcePrecision: 'exact' | 'record_only';
}
