'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CreateConversationDraftResult, ConversationDetailDTO, InquiryList } from '@/server/inquiries/contracts';
import { actor, api, denied, errorText, inquiryUrl, deniedEvent } from './client';
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
    const router = useRouter(), [allowed, setAllowed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [existing, setExisting] = useState(false), [blocked, setBlocked] = useState(false), [createdId, setCreatedId] = useState<string | null>(null);
    const key = useRef(''), intent = useRef<NewIntent | null>(null), lock = useRef(false), mounted = useRef(true), halted = useRef(false), generation = useRef(0), owner = useRef('');
    // A committed draft may outlive this screen; its late response must not restore cleared UI or navigate.
    const active = useCallback((version: number) => mounted.current && !halted.current && generation.current === version, []);
    const purge = useCallback(() => { if (!mounted.current)
        return; generation.current++; halted.current = true; key.current = ''; owner.current = ''; intent.current = null; lock.current = false; clearAll(); setCreatedId(null); setExisting(false); setAllowed(false); setBusy(false); setBlocked(true); setError('현재 권한을 확인할 수 없어 문의 초안의 보관 정보를 지웠습니다. 새 초안을 자동으로 만들지 않았습니다.'); }, []);
    const verify = useCallback(async () => { const version = generation.current; try {
        const who = await actor();
        if (!active(version))
            return;
        if (owner.current && owner.current !== who) {
            purge();
            return;
        }
        const list = await api<InquiryList>(`/api/inquiries?context=${contextId}`);
        if (!active(version))
            return;
        owner.current = who;
        key.current = freshIntentKey(who, contextId, taskId);
        if (!intent.current)
            try {
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
            catch { }
        setAllowed(list.capabilities.create);
        if (!list.capabilities.create)
            setError('GSG의 새 요청은 업무 만들기를 사용합니다. 브랜드가 보낸 문의에는 답변할 수 있습니다.');
    }
    catch (e) {
        if (active(version)) {
            if (denied(e))
                purge();
            else
                setError(errorText(e));
        }
    } }, [active, contextId, taskId, purge]);
    const retire = useCallback(() => { mounted.current = false; generation.current++; }, []);
    useEffect(() => { mounted.current = true; halted.current = false; generation.current++; void verify(); const onDenied = () => purge(), onFocus = () => { if (!halted.current)
        void verify(); }; window.addEventListener(deniedEvent, onDenied); window.addEventListener('focus', onFocus); return () => { retire(); window.removeEventListener(deniedEvent, onDenied); window.removeEventListener('focus', onFocus); }; }, [verify, purge, retire]);
    function persist(version: number) { if (active(version) && key.current && intent.current)
        storeLocal(key.current, intent.current); }
    async function start() { if (lock.current || blocked || !allowed || !mounted.current || halted.current)
        return; const version = generation.current; lock.current = true; setBusy(true); setError(''); try {
        if (!intent.current) {
            intent.current = { at: Date.now(), createKey: crypto.randomUUID(), conversationId: null };
            persist(version);
        }
        if (!intent.current.conversationId) {
            const result = await api<CreateConversationDraftResult>('/api/inquiries', { contextId, taskId, idempotencyKey: intent.current.createKey });
            if (!active(version))
                return;
            intent.current = { ...intent.current, conversationId: result.conversationId };
            persist(version);
            setCreatedId(result.conversationId);
            setExisting(true);
        }
        const d = await api<ConversationDetailDTO>(`/api/inquiries/${intent.current.conversationId}`);
        if (!active(version))
            return;
        if (d.contextId !== contextId)
            throw Error('현재 컨텍스트를 확인해 주세요.');
        router.push(inquiryUrl(d.id, contextId));
    }
    catch (e) {
        if (active(version)) {
            if (denied(e))
                purge();
            else
                setError(errorText(e));
        }
    }
    finally {
        if (active(version)) {
            lock.current = false;
            setBusy(false);
        }
    } }
    function recheck() { generation.current++; halted.current = false; setBlocked(false); setAllowed(false); setError(''); void verify(); }
    return <section className={s.stack}><Link href={`/inquiries?context=${contextId}`}>← 문의 목록</Link><header><p className="eyebrow">NEW INQUIRY</p><h1>새 문의 작성</h1><p>먼저 나만 볼 수 있는 초안을 만듭니다. 제목·본문·첨부를 준비한 뒤 첫 질문을 보내세요.</p></header>{error && <div role="alert" className={s.error}>{error}<button className="button subtle" disabled={busy} onClick={recheck}>현재 권한 다시 확인</button></div>}{allowed && !blocked && <div className={s.actions}><button className="button" disabled={busy} onClick={() => void start()}>{busy ? '초안 확인 중…' : existing ? '이전에 만든 문의 이어서 확인' : '비공개 초안 만들기'}</button>{existing && <button className="button subtle" disabled={busy} onClick={() => { intent.current = null; setCreatedId(null); try {
        sessionStorage.removeItem(key.current);
    }
    catch { } setExisting(false); }}>별도의 새 문의 시작</button>}</div>}{createdId && <p className={s.meta}>생성한 문의 ID: {createdId} · 조회만 다시 시도하며 초안을 중복 생성하지 않습니다.</p>}</section>;
}
