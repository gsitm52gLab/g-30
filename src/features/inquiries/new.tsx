'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CreateConversationDraftResult, ConversationDetailDTO, InquiryList } from '@/server/inquiries/contracts';
import { actor, api, denied, errorText, inquiryUrl } from './client';
import { clearAll, freshIntentKey, storeLocal } from './recovery';
import s from './ui.module.css';
type NewIntent = {
    at: number;
    createKey: string;
    conversationId: string | null;
};
export function NewInquiry({ contextId, taskId }: {
    contextId: string;
    taskId: string | null;
}) {
    const router = useRouter(), [allowed, setAllowed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [existing, setExisting] = useState(false), [blocked, setBlocked] = useState(false), [createdId, setCreatedId] = useState<string | null>(null), key = useRef(''), intent = useRef<NewIntent | null>(null), lock = useRef(false);
    function persist() { if (key.current && intent.current)
        storeLocal(key.current, intent.current); }
    useEffect(() => { let live = true; void (async () => { const who = await actor(), list = await api<InquiryList>(`/api/inquiries?context=${contextId}`); if (!live)
        return; key.current = freshIntentKey(who, contextId, taskId); try {
        const raw = sessionStorage.getItem(key.current);
        if (raw) {
            const old = JSON.parse(raw);
            if (Date.now() - old.at < 86400000 && typeof old.createKey === 'string' && (old.conversationId === null || typeof old.conversationId === 'string')) {
                intent.current = old;
                setCreatedId(old.conversationId);
                setExisting(true);
            }
        }
    }
    catch { } setAllowed(list.capabilities.create); if (!list.capabilities.create)
        setError('GSG의 새 요청은 업무 만들기를 사용합니다. 브랜드가 보낸 문의에는 답변할 수 있습니다.'); })().catch(e => { if (live) {
        setError(errorText(e));
        if (denied(e)) {
            clearAll();
            setBlocked(true);
        }
    } }); return () => { live = false; }; }, [contextId, taskId]);
    async function start() { if (lock.current || blocked)
        return; lock.current = true; setBusy(true); setError(''); try {
        if (!intent.current) {
            intent.current = { at: Date.now(), createKey: crypto.randomUUID(), conversationId: null };
            persist();
        }
        if (!intent.current.conversationId) {
            const result = await api<CreateConversationDraftResult>('/api/inquiries', { contextId, taskId, idempotencyKey: intent.current.createKey });
            intent.current = { ...intent.current, conversationId: result.conversationId };
            persist();
            setCreatedId(result.conversationId);
            setExisting(true);
        }
        const d = await api<ConversationDetailDTO>(`/api/inquiries/${intent.current.conversationId}`);
        if (d.contextId !== contextId)
            throw Error('현재 컨텍스트를 확인해 주세요.');
        router.push(inquiryUrl(d.id, contextId));
    }
    catch (e) {
        setError(errorText(e));
        if (denied(e)) {
            clearAll();
            intent.current = null;
            setCreatedId(null);
            setBlocked(true);
        }
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    return <section className={s.stack}><Link href={`/inquiries?context=${contextId}`}>← 문의 목록</Link><header><p className="eyebrow">NEW INQUIRY</p><h1>새 문의 작성</h1><p>먼저 나만 볼 수 있는 초안을 만듭니다. 제목·본문·첨부를 준비한 뒤 첫 질문을 보내세요.</p></header>{error && <p role="alert" className={s.error}>{error}</p>}{allowed && !blocked && <div className={s.actions}><button className="button" disabled={busy} onClick={() => void start()}>{busy ? '초안 확인 중…' : existing ? '이전에 만든 문의 이어서 확인' : '비공개 초안 만들기'}</button>{existing && <button className="button subtle" disabled={busy} onClick={() => { intent.current = null; setCreatedId(null); try {
        sessionStorage.removeItem(key.current);
    }
    catch { } setExisting(false); }}>별도의 새 문의 시작</button>}</div>}{createdId && <p className={s.meta}>생성한 문의 ID: {createdId} · 조회만 다시 시도하며 초안을 중복 생성하지 않습니다.</p>}</section>;
}
