import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { IdentityService, Principal } from '@/server/auth/service';
import type { DeliverySource } from '@/domain/notifications/records';
import { AuthError, fail, unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { currentActor } from '@/server/scheduling/access';
import { scheduleSources, visibleSource } from '@/server/scheduling/read';
import { sourceText } from '@/server/scheduling/projection';
import { sourceReminderDecision } from './eligibility';
import { notificationEventSource } from './sources';
import { deliveryId, deliveryKey, canonicalEvent, projectedSource, resolvedDelivery, readCommand } from './delivery';
import { newId, receipt, fresh } from '@/server/products/store';

export class NotificationService {
    constructor(public identity: IdentityService, private hooks: { fault?: (stage: string) => void; beforeDelivery?: () => Promise<void> } = {}) {}
    get clock() { return this.identity.clock; }
    private own(s: UnitOfWork, p: Principal, row: StoredRecord<'notification'>) {
        if (!row.contextId) unavailable();
        authorize(s, p, 'notification.read', { id: row.id, kind: 'notification', contextId: row.contextId, visibility: 'public', recipientUserId: row.data.recipientId }, this.clock);
        const current = resolvedDelivery(s, p, row.contextId, row.data.source, this.clock, false);
        if (!current || current.key !== row.data.key || row.data.email !== 'not_connected') unavailable();
        return current;
    }
    private dto(s: UnitOfWork, p: Principal, row: StoredRecord<'notification'>) {
        this.own(s, p, row);
        return { id: row.id, revision: row.revision, source: projectedSource(row.data.source), title: sourceText(row.data.title, 200), message: sourceText(row.data.message, 2000), actionUrl: sourceText(row.data.actionUrl, 4000), occurredAt: sourceText(row.data.occurredAt), deliveredAt: sourceText(row.data.deliveredAt), readAt: row.data.readAt === null ? null : sourceText(row.data.readAt), certainty: row.data.certainty, inApp: 'delivered' as const, email: 'not_connected' as const };
    }
    async list(token: string | undefined, contextId: string) { return this.identity.repo.transaction(s => {
        const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock);
        const items = s.list('notification', contextId).filter(r => r.data.recipientId === p.user.id).flatMap(r => { const dto = visibleSource(() => this.dto(s, p, r)); return dto ? [dto] : []; }).sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || a.id.localeCompare(b.id));
        const failures = s.list('notificationAttempt', contextId).filter(r => r.data.recipientId === p.user.id && r.data.state === 'failed').filter(r => !s.get('notificationReceipt', deliveryId(r.data.key))).flatMap(r => {
            const resolved = visibleSource(() => resolvedDelivery(s, p, contextId, r.data.source, this.clock, true));
            return resolved && resolved.key === r.data.key ? [{ id: r.id, key: r.data.key, title: resolved.title, at: sourceText(r.data.at), errorCode: 'DELIVERY_FAILED' as const, message: '앱 알림을 저장하지 못했습니다. 다시 시도해 주세요.', canRetry: true }] : [];
        }).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).filter((r, i, rows) => rows.findIndex(x => x.key === r.key) === i).map(r => ({ id: r.id, title: r.title, at: r.at, errorCode: r.errorCode, message: r.message, canRetry: r.canRetry }));
        return { contextId, items, total: items.length, unread: items.filter(r => r.readAt === null).length, failures, delivery: { inApp: 'app_open_sync' as const, email: 'not_connected' as const, background: 'not_connected' as const } };
    }); }
    async read(token: string | undefined, id: string, input: unknown) {
        const x = readCommand(input);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), row = s.get('notification', id); if (!row) unavailable(); this.own(s, p, row);
            return receipt(s, p, row.contextId!, `notification.read:${id}`, x, () => { fresh(row, x.expectedRevision); s.update('notification', row.id, row.revision, { ...row.data, readAt: x.read ? this.clock() : null }); return { ids: [row.id] }; });
        });
    }
    private store(s: UnitOfWork, p: Principal, contextId: string, source: DeliverySource, permitCanonical = true): { state: 'delivered' | 'reused' | 'suppressed'; id: string | null } {
        const resolved = resolvedDelivery(s, p, contextId, source, this.clock, true); if (!resolved) return { state: 'suppressed', id: null };
        const key = resolved.key, existing = s.get('notificationReceipt', deliveryId(key));
        if (existing) { const n = s.get('notification', existing.data.notificationId); if (!n) unavailable(); this.own(s, p, n); return { state: 'reused', id: n.id }; }
        let canonical: StoredRecord<'notification'> | null = null, canonicalCreated = false;
        const canonicalId = permitCanonical ? canonicalEvent(s, source) : null;
        if (canonicalId && source.kind === 'event' && canonicalId !== source.eventId) {
            const c = resolvedDelivery(s, p, contextId, { kind: 'event', eventId: canonicalId }, this.clock, true);
            if (c) { const result = this.store(s, p, contextId, c.source, false); if (result.id) { canonical = s.get('notification', result.id); canonicalCreated = result.state === 'delivered'; } }
        }
        const notification = canonical ?? s.create('notification', { id: deliveryId(key), contextId, data: { key, semanticKey: source.kind === 'event' && canonicalId === source.eventId ? JSON.stringify(['campaign-publication', canonicalId, p.user.id]) : null, recipientId: p.user.id, source: resolved.source, title: resolved.title, message: resolved.message, actionUrl: resolved.actionUrl, occurredAt: resolved.occurredAt, deliveredAt: this.clock(), readAt: null, certainty: resolved.certainty, email: 'not_connected' } });
        this.hooks.fault?.('after_notification');
        s.create('notificationReceipt', { id: deliveryId(key), contextId, data: { key, recipientId: p.user.id, source: resolved.source, notificationId: notification.id, deduplicated: !!canonical, at: this.clock() } });
        this.hooks.fault?.('after_receipt');
        s.create('notificationAttempt', { id: newId(), contextId, data: { key, recipientId: p.user.id, source: resolved.source, state: canonical ? 'deduplicated' : 'delivered', at: this.clock(), errorCode: null, notificationId: notification.id } });
        return { state: canonical && !canonicalCreated ? 'reused' : 'delivered', id: notification.id };
    }
    private async deliver(token: string | undefined, contextId: string, source: DeliverySource) {
        await this.hooks.beforeDelivery?.(); // Test hook; normal route performs no external IO.
        try { return await this.identity.repo.transaction(s => { const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock); return this.store(s, p, contextId, source); }); }
        catch (e) {
            if (e instanceof AuthError && e.status < 500) throw e;
            return this.identity.repo.transaction(s => {
                const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock), resolved = resolvedDelivery(s, p, contextId, source, this.clock, true);
                if (!resolved) return { state: 'suppressed' as const, id: null };
                const completed = s.get('notificationReceipt', deliveryId(resolved.key)); if (completed) return { state: 'reused' as const, id: completed.data.notificationId };
                s.create('notificationAttempt', { id: newId(), contextId, data: { key: resolved.key, recipientId: p.user.id, source: resolved.source, state: 'failed', at: this.clock(), errorCode: 'DELIVERY_FAILED', notificationId: null } });
                return { state: 'failed' as const, id: null };
            });
        }
    }
    async sync(token: string | undefined, contextId: string) {
        const candidates = await this.identity.repo.transaction(s => {
            const p = currentActor(s, this.identity.principal(s, token), contextId, this.clock), rows: DeliverySource[] = [];
            for (const e of s.list('domainEvent', contextId).sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id))) {
                const fact = visibleSource(() => notificationEventSource(s, p, e.id, this.clock)); if (fact?.disposition === 'eligible' && fact.recipientId === p.user.id) rows.push({ kind: 'event', eventId: e.id });
            }
            for (const row of scheduleSources(s, p, contextId, this.clock)) { const d = sourceReminderDecision(row, this.clock()); if (d.eligible) rows.push({ kind: 'reminder', logicalKey: row.logicalKey, source: row.source, localDay: d.calendar.localToday, stage: d.calendar.stage! }); }
            const pending = rows.filter(source => { const key = deliveryKey(source, p.user.id); return !s.get('notificationReceipt', deliveryId(key)) && !s.list('notificationAttempt', contextId).some(a => a.data.key === key && a.data.state === 'failed'); });
            return { rows: pending.slice(0, 100), hasMore: pending.length > 100 };
        });
        const counts = { delivered: 0, reused: 0, suppressed: 0, failed: 0 };
        for (const source of candidates.rows) counts[(await this.deliver(token, contextId, source)).state]++;
        return { ...counts, hasMore: candidates.hasMore, ...(await this.list(token, contextId)) };
    }
    async retry(token: string | undefined, id: string) {
        const target = await this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), row = s.get('notificationAttempt', id); if (!row?.contextId || row.data.recipientId !== p.user.id || row.data.state !== 'failed') unavailable(); currentActor(s, p, row.contextId, this.clock);
            const source = projectedSource(row.data.source), resolved = resolvedDelivery(s, p, row.contextId, source, this.clock, true);
            if (!resolved || resolved.key !== row.data.key) fail('CONFLICT', 409, '현재 일정과 담당자가 변경되었습니다. 새 목록을 확인해 주세요.');
            return { contextId: row.contextId, source };
        });
        return this.deliver(token, target.contextId, target.source);
    }
}
