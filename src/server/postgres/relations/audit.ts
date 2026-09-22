// Async equivalent of the original G14 audit relation; source hash is tracked.
import { StoreError, type RecordKind, type RecordInput, type UnitOfWork } from '@/domain/records';
export async function auditRelations(s: UnitOfWork, kind: RecordKind, input: RecordInput<RecordKind>) {
    if (kind !== 'audit')
        return;
    if (await s.get('audit', input.id))
        throw new StoreError('INVALID_RECORD');
    const d = input.data as import('@/domain/records').AuditData;
    if (typeof d.actorId !== 'string' || typeof d.action !== 'string' || typeof d.targetId !== 'string' || typeof d.at !== 'string')
        throw new StoreError('INVALID_RECORD');
    if (d.detail && (d.detail.schemaVersion !== 2 || typeof d.detail.operationId !== 'string' || !Array.isArray(d.detail.references) || !Array.isArray(d.detail.changes)))
        throw new StoreError('INVALID_RECORD');
}
