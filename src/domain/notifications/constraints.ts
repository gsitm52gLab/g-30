import { StoreError, type RecordKind, type RecordInput, type UnitOfWork } from '@/domain/records';
export function notificationRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['notification', 'notificationReceipt', 'notificationAttempt'].includes(kind)) return;
    const d = input.data as import('./records').NotificationData | import('./records').NotificationReceiptData | import('./records').NotificationAttemptData;
    if (!input.contextId || !s.get('context', input.contextId) || !s.get('user', d.recipientId) || typeof d.key !== 'string' || !d.key) throw new StoreError('INVALID_RECORD');
    const old = s.get(kind, input.id);
    if (kind === 'notification') {
        const n = d as import('./records').NotificationData;
        if (n.email !== 'not_connected') throw new StoreError('INVALID_RECORD');
        if (old) { const { readAt: _old, ...before } = old.data as import('./records').NotificationData, { readAt: _new, ...after } = n; void _old; void _new; if (JSON.stringify(before) !== JSON.stringify(after)) throw new StoreError('INVALID_RECORD'); }
        if (s.list('notification').some(r => r.id !== input.id && (r.data.key === n.key || n.semanticKey !== null && r.data.semanticKey === n.semanticKey))) throw new StoreError('CONFLICT');
    } else {
        if (old) throw new StoreError('INVALID_RECORD');
        if (kind === 'notificationReceipt' && s.list('notificationReceipt').some(r => r.data.key === d.key)) throw new StoreError('CONFLICT');
        const n = (d as import('./records').NotificationReceiptData).notificationId;
        if (n && (s.get('notification', n)?.contextId !== input.contextId || s.get('notification', n)?.data.recipientId !== d.recipientId)) throw new StoreError('INVALID_RECORD');
    }
}
