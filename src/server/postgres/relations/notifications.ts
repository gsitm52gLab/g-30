// Explicit asynchronous counterpart of src/domain/notifications/constraints.ts; source hash tracked in source-map.json.
import { isDeepStrictEqual } from 'node:util';
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
export async function notificationRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['notification', 'notificationReceipt', 'notificationAttempt'].includes(kind))
        return;
    const d = input.data as import("@/domain/notifications/records").NotificationData | import("@/domain/notifications/records").NotificationReceiptData | import("@/domain/notifications/records").NotificationAttemptData;
    if (!input.contextId || !(await s.get('context', input.contextId)) || !(await s.get('user', d.recipientId)) || typeof d.key !== 'string' || !d.key)
        throw new StoreError('INVALID_RECORD');
    const old = (await s.get(kind, input.id));
    if (kind === 'notification') {
        const n = d as import("@/domain/notifications/records").NotificationData;
        if (n.email !== 'not_connected')
            throw new StoreError('INVALID_RECORD');
        if (old) {
            const { readAt: _old, ...before } = old.data as import("@/domain/notifications/records").NotificationData, { readAt: _new, ...after } = n;
            void _old;
            void _new;
            if (!isDeepStrictEqual(before, after))
                throw new StoreError('INVALID_RECORD');
        }
        if ((await s.list('notification')).some(r => r.id !== input.id && (r.data.key === n.key || n.semanticKey !== null && r.data.semanticKey === n.semanticKey)))
            throw new StoreError('CONFLICT');
    }
    else {
        if (old)
            throw new StoreError('INVALID_RECORD');
        if (kind === 'notificationReceipt' && (await s.list('notificationReceipt')).some(r => r.data.key === d.key))
            throw new StoreError('CONFLICT');
        const n = (d as import("@/domain/notifications/records").NotificationReceiptData).notificationId;
        if (n && ((await s.get('notification', n))?.contextId !== input.contextId || (await s.get('notification', n))?.data.recipientId !== d.recipientId))
            throw new StoreError('INVALID_RECORD');
    }
}
