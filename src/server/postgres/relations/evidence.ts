// Explicit asynchronous counterpart of src/domain/evidence/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordInput, type RecordKind } from "@/domain/records";
export async function evidenceRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['evidence', 'evidenceVersion', 'evidenceLink', 'evidenceAssessment', 'importBatch'].includes(kind))
        return;
    const invalid = () => { throw new StoreError('INVALID_RECORD'); };
    if (!input.contextId || !(await s.get('context', input.contextId)))
        invalid();
    const d = input.data as unknown as Record<string, unknown>;
    if (['evidenceVersion', 'evidenceAssessment', 'importBatch'].includes(kind) && (await s.get(kind, input.id)))
        invalid();
    const parent = kind === 'evidenceVersion' ? ['evidence', 'evidenceId'] as const : kind === 'evidenceAssessment' ? ['evidenceLink', 'linkId'] as const : null;
    if (parent) {
        if ((await s.get(parent[0], String(d[parent[1]])))?.contextId !== input.contextId)
            invalid();
        if ((await s.list(kind, input.contextId!)).some(r => { const v = r.data as unknown as Record<string, unknown>; return v[parent[1]] === d[parent[1]] && v.sequence === d.sequence; }))
            throw new StoreError('CONFLICT');
        if (d.previousId) {
            const old = (await s.get(kind, String(d.previousId)));
            if (!old || (old.data as unknown as Record<string, unknown>)[parent[1]] !== d[parent[1]])
                invalid();
        }
    }
    if (kind === 'evidenceLink') {
        const cp = (await s.get('contextProduct', String(d.contextProductId)));
        if (!cp || cp.contextId !== input.contextId || cp.data.productId !== d.productId || (await s.get('evidenceVersion', String(d.evidenceVersionId)))?.contextId !== input.contextId)
            invalid();
        if ((await s.list('evidenceLink', input.contextId!)).some(r => r.id !== input.id && r.data.evidenceVersionId === d.evidenceVersionId && r.data.productId === d.productId))
            throw new StoreError('CONFLICT');
        const old = (await s.get('evidenceLink', input.id));
        if (old && (old.data.evidenceVersionId !== d.evidenceVersionId || old.data.productId !== d.productId || old.data.contextProductId !== d.contextProductId))
            invalid();
    }
}
