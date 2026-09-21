'use client';
import { NotificationCenter, type NotificationPresentation, type NotificationViewState } from './views';
import { useInbox } from './store';
import s from './ui.module.css';
export function NotificationScreen({ contextId }: {
    contextId: string;
}) {
    const c = useInbox(contextId), v = c.snapshot;
    const items: NotificationPresentation[] = v.data?.items.map(n => ({ id: n.id, title: n.title, eventLabel: n.source.kind === 'event' ? '업무 변경' : '일정 알림', occurredAt: n.occurredAt, occurredAtLabel: n.occurredAt, detail: n.message, status: { inApp: n.inApp, readAt: n.readAt, email: n.email }, workLink: { href: n.actionUrl, label: '관련 업무 열기' }, readFailure: null, deliveryFailure: null, canRetry: false })) ?? [];
    const state: NotificationViewState = v.status === 'ready' && v.data ? { status: 'ready', items, total: v.data.total, unreadCount: v.data.unread, filtered: false } : v.status === 'loading' ? { status: 'loading' } : { status: v.status === 'denied' ? 'denied' : 'error', message: v.error };
    return <div className={s.stack}><NotificationCenter state={state} sync={{ connection: 'app_open', state: v.busy ? 'syncing' : v.error ? 'failed' : 'idle', lastCheckedLabel: v.lastChecked, failure: v.error }} busyIds={v.pending ? items.map(i => i.id) : v.busy ? items.map(i => i.id) : v.busyIds} onReadChange={(id, read) => void c.read(id, read)} onRetry={id => void c.retry(id)} onRefresh={() => void c.sync()}/>{v.status !== 'denied' && <>{v.message && <p role="status" className={s.connection}>{v.message}</p>}{v.pending && <section className={s.card}><h2>{v.pending.conflict ? '읽음 상태 동시 수정' : v.pending.committed ? '저장 완료 · 조회 확인' : '읽음 요청 결과 확인'}</h2><p>표시 의도와 요청 키를 유지합니다. 자동으로 새 버전을 덮어쓰지 않습니다.</p><button className="button subtle" disabled={v.busyIds.length > 0 || v.busy} onClick={() => void (v.pending?.conflict ? c.rebase() : c.read(v.pending!.id, v.pending!.body.read))}>{v.pending.conflict ? '최신 상태 확인·기준 선택' : v.pending.committed ? '저장 상태 다시 조회' : '같은 요청으로 확인'}</button></section>}{!!v.data?.failures.length && <section className={s.card}><h2>앱 알림 저장 실패</h2>{v.data.failures.map(f => <article key={f.id}><h3>{f.title}</h3><p>{f.message}</p><p>{f.at}</p><button className="button subtle" disabled={v.busy || v.busyIds.length > 0 || !!v.pending} onClick={() => void c.retry(f.id)}>실패한 알림 다시 저장</button></article>)}</section>}</>}</div>;
}
