'use client';
import Link from 'next/link';
import { useInbox } from './store';
export function NotificationPulse({ contextId }: {
    contextId: string;
}) { const { snapshot: s, sync } = useInbox(contextId); return <div aria-label="내 앱 알림"><Link className="button subtle" href={`/notifications?context=${encodeURIComponent(contextId)}`}>알림{s.status === 'ready' && s.data ? ` · 안 읽음 ${s.data.unread}건` : s.status === 'denied' ? ' · 접근 확인' : s.status === 'error' ? ' · 연결 확인' : ' · 확인 중'}</Link>{s.error && s.status !== 'denied' && <button type="button" className="button subtle" disabled={s.busy} onClick={() => void sync()}>알림 재확인</button>}</div>; }
