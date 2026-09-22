import type { AuditDetail, AuditValue } from '@/domain/audit/types';
import type { RecordKind } from '@/domain/records';
import { corrupt, text } from '@/server/search/safe';
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    corrupt(); return v as Record<string, unknown>; }
function id(v: unknown) { const x = text(v, 160); if (!/^[A-Za-z0-9_-]+$/.test(x))
    corrupt(); return x; }
function array(v: unknown): unknown[] { if (!Array.isArray(v) || v.length > 2000)
    corrupt(); return v; }
function value(v: unknown): AuditValue { if (v === null || typeof v === 'boolean')
    return v; if (typeof v === 'number') {
    if (!Number.isFinite(v))
        corrupt();
    return v;
} if (Array.isArray(v))
    return array(v).map(x => text(x)); return text(v); }
/** Known fields validated before output; unknown extensions never enter match or DTO. */
export function auditDetail(v: unknown): AuditDetail { const d = object(v); if (d.schemaVersion !== 2 || typeof d.sensitivity !== 'string' || typeof d.sourcePrecision !== 'string' || !['standard', 'internal_price'].includes(String(d.sensitivity)) || !['exact', 'record_only'].includes(String(d.sourcePrecision)))
    corrupt(); const subject = d.subject === null ? null : object(d.subject); return { schemaVersion: 2, operationId: id(d.operationId), receiptId: d.receiptId === null ? null : id(d.receiptId), subject: subject ? { kind: id(subject.kind) as RecordKind, id: id(subject.id) } : null, sensitivity: d.sensitivity as AuditDetail['sensitivity'], sourcePrecision: d.sourcePrecision as AuditDetail['sourcePrecision'], references: array(d.references).map(x => { const r = object(x); if (typeof r.role !== 'string' || !['before', 'after', 'source'].includes(r.role))
        corrupt(); return { kind: id(r.kind) as RecordKind, id: id(r.id), role: r.role as 'before' | 'after' | 'source' }; }), changes: array(d.changes).map(x => { const c = object(x); return { key: text(c.key, 120), before: value(c.before), after: value(c.after) }; }) }; }
