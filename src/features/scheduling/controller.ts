'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScheduleList, ScheduleDetail, ScheduleContent } from '@/server/scheduling/contracts';
import { explicitZonedInstant } from '@/domain/scheduling/calendar';
import { blank, localFields } from './model';
import type { DateTimeFields } from './presentation';
import { request, currentActor, denied, deniedEvent, announceDenied, ScheduleError } from './client';
type Body = {
    command: 'save' | 'done' | 'cancel' | 'reopen';
    contextId: string;
    scheduleId: string | null;
    expectedRevision: number;
    content?: ScheduleContent;
    reason: string;
    idempotencyKey: string;
};
type Pending = {
    body: Body;
    ids: string[] | null;
    conflict: boolean;
};
type Editor = {
    id: string | null;
    revision: number;
    value: ScheduleContent;
    dateTime: DateTimeFields;
    reason: string;
};
type Saved = {
    actorId: string;
    contextId: string;
    editor: Editor;
    pending: Pending | null;
};
export function useSchedule(initial: {
    actorId: string;
    list: ScheduleList;
    detail: ScheduleDetail | null;
}, initialTask: string) {
    const contextId = initial.list.contextId, key = `gs-hale:g13:schedule:${initial.actorId}:${contextId}:${initial.detail?.id ?? 'new'}`;
    const seed: Editor = { id: initial.detail?.id ?? null, revision: initial.detail?.revision ?? 0, value: initial.detail?.current.content ?? blank(initialTask), dateTime: localFields(initial.detail?.current.content.deadline ?? blank().deadline), reason: '' };
    const [list, setList] = useState<ScheduleList | null>(initial.list), [detail, setDetail] = useState(initial.detail), [editor, setEditor] = useState(seed), [pending, setPending] = useState<Pending | null>(null), [recovery, setRecovery] = useState<Saved | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [storageError, setStorageError] = useState('');
    const live = useRef({ alive: false, halted: false, generation: 0, locked: false, read: 0 }), state = useRef({ editor: seed, pending: null as Pending | null }), latest = useRef(initial.detail);
    const active = useCallback((g: number) => live.current.alive && !live.current.halted && g === live.current.generation, []);
    const purge = useCallback(() => { live.current.halted = true; live.current.generation++; live.current.locked = false; state.current = { editor: { id: null, revision: 0, value: blank(), dateTime: { local: '', offset: '' }, reason: '' }, pending: null }; setList(null); setDetail(null); setEditor(state.current.editor); setPending(null); setRecovery(null); setReady(false); setBusy(false); setMessage(''); setStorageError(''); setError('현재 접근 권한을 확인할 수 없습니다. 로그인과 담당 범위를 확인한 뒤 다시 열어 주세요.'); try {
        sessionStorage.removeItem(key);
    }
    catch { } }, [key]);
    const handle = useCallback((e: unknown, g: number) => { if (!active(g))
        return; if (denied(e)) {
        purge();
        announceDenied(contextId);
    }
    else
        setError(e instanceof Error ? e.message : '연결을 확인해 주세요. 작성값은 유지됩니다.'); }, [active, purge, contextId]);
    function persist() { if (!active(live.current.generation))
        return; try {
        sessionStorage.setItem(key, JSON.stringify({ actorId: initial.actorId, contextId, ...state.current }));
        setStorageError('');
    }
    catch {
        setStorageError('이 브라우저에 복구 기록을 저장하지 못했습니다. 화면을 닫기 전에 저장 결과를 확인해 주세요.');
    } }
    function edit(next: Editor) { if (!active(live.current.generation) || state.current.pending)
        return; state.current.editor = next; setEditor(next); persist(); }
    function mark(p: Pending | null) { state.current.pending = p; setPending(p); persist(); }
    const refresh = useCallback(async (id?: string | null, filters = '') => { const g = live.current.generation, seq = ++live.current.read; try {
        await currentActor(contextId, initial.actorId);
        if (!active(g))
            return null;
        const [l, d] = await Promise.all([request<ScheduleList>(`/api/schedule?context=${encodeURIComponent(contextId)}${filters}`), (id === undefined ? latest.current?.id : id) ? request<ScheduleDetail>(`/api/schedule/${encodeURIComponent((id === undefined ? latest.current!.id : id)!)}`) : Promise.resolve(null)]);
        if (!active(g) || seq !== live.current.read)
            return null;
        if (l.contextId !== contextId || d && d.contextId !== contextId || latest.current?.capabilities.manage && d && !d.capabilities.manage) {
            purge();
            return null;
        }
        setList(l);
        setDetail(d);
        latest.current = d;
        setReady(true);
        setError('');
        return { list: l, detail: d };
    }
    catch (e) {
        handle(e, g);
        return null;
    } }, [contextId, initial.actorId, active, handle, purge]);
    useEffect(() => { const life = live.current; life.alive = true; life.halted = false; const g = ++life.generation; void Promise.resolve().then(() => refresh()).then(v => { if (!v || !active(g))
        return; try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
            const saved = JSON.parse(raw) as Saved;
            if (saved.actorId === initial.actorId && saved.contextId === contextId && saved.editor && saved.editor.value && (!saved.editor.id || saved.editor.id === initial.detail?.id || saved.pending?.ids?.[0] === saved.editor.id)) {
                if (v.list.capabilities.create)
                    setRecovery(saved);
                else
                    sessionStorage.removeItem(key);
            }
        }
    }
    catch {
        setStorageError('저장된 복구 기록을 읽지 못했습니다. 현재 서버 기록을 확인해 주세요.');
    } }); const focus = () => { if (document.visibilityState === 'visible')
        void refresh(); }; const revoked = (e: Event) => { if ((e as CustomEvent).detail === contextId)
        purge(); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); window.addEventListener(deniedEvent, revoked); const timer = setInterval(focus, 30000); return () => { life.alive = false; life.generation++; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); window.removeEventListener(deniedEvent, revoked); }; }, [refresh, active, key, initial.actorId, contextId, initial.detail?.id, purge]);
    function reconcile(d: ScheduleDetail) { const next = { id: d.id, revision: d.revision, value: d.current.content, dateTime: localFields(d.current.content.deadline), reason: '' }; state.current = { editor: next, pending: null }; setEditor(next); setPending(null); setRecovery(null); setMessage('저장 결과를 확인했습니다. 이 일정의 종료와 업무 완료는 별도입니다.'); try {
        sessionStorage.removeItem(key);
    }
    catch { } ; }
    async function reread() { const p = state.current.pending; const v = await refresh(p?.ids?.[0] ?? state.current.editor.id); if (v?.detail && p?.ids)
        reconcile(v.detail); }
    async function execute(command: Body['command'] = 'save') {
        if (live.current.locked || !ready || !active(live.current.generation))
            return;
        const old = state.current.pending;
        if (old?.ids) {
            await reread();
            return;
        }
        if (old?.conflict) {
            setError('최신 기록을 비교한 뒤 기준 버전을 명시적으로 선택해 주세요.');
            return;
        }
        let p = old;
        try {
            if (!p) {
                const e = state.current.editor;
                let content = e.value;
                if (command === 'save' && content.deadline.precision === 'datetime' && content.deadline.value !== null)
                    content = { ...content, deadline: { ...content.deadline, value: explicitZonedInstant(e.dateTime.local, e.dateTime.offset, content.deadline.timezone) } };
                p = { body: { command, contextId, scheduleId: e.id, expectedRevision: e.revision, ...(command === 'save' ? { content } : {}), reason: e.reason, idempotencyKey: crypto.randomUUID() }, ids: null, conflict: false };
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '날짜를 확인해 주세요.');
            return;
        }
        const g = live.current.generation;
        live.current.locked = true;
        setBusy(true);
        setError('');
        setMessage('');
        mark(p);
        try {
            await currentActor(contextId, initial.actorId);
            if (!active(g))
                return;
            const result = await request<{
                ids: string[];
            }>('/api/schedule', p.body, () => active(g));
            if (!active(g))
                return;
            const committed = { ...p, ids: result.ids };
            mark(committed);
            setMessage('저장은 완료됐습니다. 확정 ID로 최신 기록을 확인합니다.');
            const v = await refresh(result.ids[0]);
            if (v?.detail && active(g))
                reconcile(v.detail);
        }
        catch (e) {
            if (active(g)) {
                if (e instanceof ScheduleError && e.status === 409)
                    mark({ ...p, conflict: true });
                else if (e instanceof ScheduleError && e.status === 422)
                    mark(null);
                handle(e, g);
            }
        }
        finally {
            if (active(g)) {
                live.current.locked = false;
                setBusy(false);
            }
        }
    }
    async function rebase() { const v = await refresh(state.current.editor.id); if (!v)
        return; const next = { ...state.current.editor, revision: v.detail?.revision ?? 0 }; state.current = { editor: next, pending: null }; setEditor(next); setPending(null); persist(); setMessage('작성값을 유지하고 최신 버전을 기준으로 선택했습니다. 차이를 확인하고 다시 저장해 주세요.'); }
    function restore() { if (!recovery || !active(live.current.generation))
        return; state.current = { editor: recovery.editor, pending: recovery.pending }; setEditor(recovery.editor); setPending(recovery.pending); setRecovery(null); persist(); }
    return { list, detail, editor, edit, pending, recovery, restore, discardRecovery: () => { setRecovery(null); try {
            sessionStorage.removeItem(key);
        }
        catch { } }, ready, busy, error, message, storageError, refresh, execute, rebase, reread };
}
