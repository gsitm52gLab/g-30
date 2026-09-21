'use client';
import type { NotificationStatus } from '@/domain/notifications/types';
import s from './ui.module.css';
export interface NotificationPresentation {
    id: string;
    title: string;
    eventLabel: string;
    occurredAtLabel: string;
    occurredAt: string;
    detail: string;
    status: NotificationStatus;
    workLink: {
        href: string;
        label: string;
    } | null;
    readFailure: string | null;
    deliveryFailure: string | null;
    canRetry: boolean;
}
export type NotificationViewState = {
    status: 'loading';
} | {
    status: 'denied';
    message: string;
} | {
    status: 'error';
    message: string;
} | {
    status: 'ready';
    items: NotificationPresentation[];
    unreadCount: number;
    total: number;
    filtered: boolean;
};
export interface NotificationSyncPresentation {
    connection: 'not_connected' | 'app_open';
    state: 'idle' | 'syncing' | 'failed';
    lastCheckedLabel: string | null;
    failure: string | null;
}
interface Props {
    state: NotificationViewState;
    sync: NotificationSyncPresentation;
    busyIds: string[];
    onReadChange: (id: string, read: boolean) => void;
    onRetry: (id: string) => void;
    onRefresh: () => void;
}
const deliveryLabels: Record<NotificationStatus['inApp'], string> = { pending: '앱 알림 대기', delivered: '앱 알림 저장됨', failed: '앱 알림 저장 실패', suppressed: '현재 조건으로 알림 제외' };
export function NotificationCenter({ state, sync, busyIds, onReadChange, onRetry, onRefresh }: Props) {
    if (state.status === 'denied')
        return <section className={s.empty}><h2>알림을 볼 수 없습니다</h2><p>{state.message}</p></section>;
    return <div className={s.stack}>
    <section className={s.connection} aria-label="알림 연결 상태"><div><strong>앱 알림 · {sync.connection === 'app_open' ? '화면을 열 때 확인' : '연결 전'}</strong><p>{sync.lastCheckedLabel ? `마지막 확인: ${sync.lastCheckedLabel}` : '아직 확인 시각이 없습니다.'}</p><p>이메일 · 미연동</p><p className={s.hint}>이메일 발송 또는 앱을 닫은 동안의 자동 처리를 뜻하지 않습니다.</p></div><button type="button" className="button subtle" disabled={sync.connection !== 'app_open' || sync.state === 'syncing' || state.status === 'loading'} onClick={onRefresh}>{sync.state === 'syncing' ? '확인 중…' : '알림 다시 확인'}</button></section>
    {sync.state === 'failed' && <p className={s.error} role="alert">{sync.failure || '알림을 동기화하지 못했습니다. 다시 확인해 주세요.'}</p>}
    <p className={s.hint}>알림의 읽음 표시는 공지 수락·문의 읽음·자료 제출·업무 완료와 별개입니다.</p>
    {state.status === 'loading' ? <p role="status" className={s.note}>알림을 불러오는 중입니다.</p> : state.status === 'error' ? <p role="alert" className={s.error}>{state.message}</p> : <>
      <div className={s.summary}><strong>안 읽은 알림 {state.unreadCount}건</strong><span>{state.filtered ? '현재 필터' : '전체'} {state.total}건</span></div>
      {state.items.length === 0 ? <section className={s.empty}><h2>{state.filtered ? '조건에 맞는 알림이 없습니다' : '아직 알림이 없습니다'}</h2><p>접근할 수 있는 업무의 알림이 여기에 표시됩니다.</p></section> : <ul className={s.list}>{state.items.map(item => {
                    const read = item.status.readAt !== null, busy = busyIds.includes(item.id);
                    return <li className={`${s.card} ${read ? '' : s.unread}`} key={item.id}><div className={s.row}><span className={s.badge}>{read ? '읽음' : '안 읽음'}</span><span>{item.eventLabel}</span><time dateTime={item.occurredAt}>{item.occurredAtLabel}</time></div><h3>{item.title}</h3>{item.detail && <p className={s.prose}>{item.detail}</p>}<p className={s.hint}>{deliveryLabels[item.status.inApp]} · 이메일 미연동</p>
          <div className={s.actions}>{item.workLink ? <a className="button subtle" href={item.workLink.href}>{item.workLink.label}</a> : <span className={s.hint}>현재 열 수 있는 업무 링크가 없습니다.</span>}<button type="button" className="button subtle" disabled={busy || item.status.inApp !== 'delivered'} aria-label={`${item.title} ${read ? '안 읽음으로 표시' : '읽음 표시'}`} onClick={() => onReadChange(item.id, !read)}>{busy ? '저장 중…' : read ? '안 읽음으로 표시' : '읽음 표시'}</button>{item.canRetry && <button type="button" className="button subtle" disabled={busy} onClick={() => onRetry(item.id)}>알림 저장 다시 시도</button>}</div>
          {item.readFailure && <p role="alert" className={s.error}>{item.readFailure} 읽음 상태가 저장되지 않았습니다.</p>}{item.deliveryFailure && <p role="alert" className={s.error}>{item.deliveryFailure}</p>}
        </li>;
                })}</ul>}
    </>}
  </div>;
}
