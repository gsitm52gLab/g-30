'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CorrectionPreview, CorrectionCommandResult } from '@/server/corrections/contracts';
import { blankEditors, type Workspace, type EditorState, type CommandInput } from './model';
import { request, denied, CorrectionError } from './client';
import { readRecovery, writeRecovery, clearRecovery, type Pending, type Recovery } from './recovery';
export function useCorrections(initial: Workspace) {
    const [w, setW] = useState<Workspace | null>(initial), [editors, setEditors] = useState<EditorState>(blankEditors), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [storageError, setStorageError] = useState(''), [pending, setPending] = useState<Pending | null>(null), [recoverable, setRecoverable] = useState<Recovery | null>(null), [preview, setPreview] = useState<{
        draftId: string;
        revision: number;
        value: CorrectionPreview;
    } | null>(null);
    const live = useRef({ alive: false, halted: false, generation: 0, locked: false }), state = useRef({ editors: blankEditors(), pending: null as Pending | null }), latest = useRef(initial);
    const active = useCallback((g: number) => live.current.alive && !live.current.halted && live.current.generation === g, []);
    const purge = useCallback(() => { live.current.halted = true; live.current.generation++; live.current.locked = false; state.current = { editors: blankEditors(), pending: null }; clearRecovery(); setW(null); setEditors(blankEditors()); setPending(null); setRecoverable(null); setPreview(null); setBusy(false); setReady(false); setMessage(''); setError('현재 접근 권한을 확인할 수 없습니다. 로그인과 담당 범위를 확인한 뒤 화면을 다시 열어 주세요.'); }, []);
    function persist() { if (!live.current.halted && live.current.alive)
        setStorageError(writeRecovery({ actorId: initial.actorId, contextId: initial.contextId, taskId: initial.taskId, at: Date.now(), ...state.current })); }
    function edit(next: EditorState) { if (!active(live.current.generation))
        return; state.current.editors = next; setEditors(next); setPreview(null); persist(); }
    function mark(next: Pending | null) { state.current.pending = next; setPending(next); persist(); }
    const handle = useCallback((e: unknown, g: number) => { if (!active(g))
        return; if (denied(e)) {
        purge();
        return;
    } setError(e instanceof Error ? e.message : '연결을 확인해 주세요. 작성값은 유지됩니다.'); }, [active, purge]);
    const refresh = useCallback(async () => { const g = live.current.generation; try {
        const next = await request<Workspace>(`/api/corrections?taskId=${encodeURIComponent(initial.taskId)}`);
        if (!active(g))
            return null;
        if (next.actorId !== initial.actorId || next.contextId !== initial.contextId) {
            purge();
            return null;
        }
        if (latest.current.capabilities.manage && !next.capabilities.manage || latest.current.capabilities.reflect && !next.capabilities.reflect) {
            purge();
            return null;
        }
        latest.current = next;
        setW(next);
        setReady(true);
        setError('');
        return next;
    }
    catch (e) {
        handle(e, g);
        return null;
    } }, [initial.taskId, initial.actorId, initial.contextId, active, purge, handle]);
    useEffect(() => { const lifecycle = live.current; lifecycle.alive = true; lifecycle.halted = false; const g = ++lifecycle.generation; void Promise.resolve().then(refresh).then(next => { if (!next || !active(g))
        return; const saved = readRecovery(next); if (saved && (!next.capabilities.manage && (saved.editors.opinion || saved.editors.review || saved.editors.draft.items.length || saved.pending && saved.pending.body.command !== 'reflect') || !next.capabilities.manage && !next.capabilities.reflect)) {
        clearRecovery();
        setRecoverable(null);
    }
    else
        setRecoverable(saved); setReady(true); }); const focus = () => { void refresh(); }; window.addEventListener('focus', focus); const timer = setInterval(focus, 20000); return () => { lifecycle.alive = false; lifecycle.generation++; clearInterval(timer); window.removeEventListener('focus', focus); }; }, [refresh, active]);
    function reconcile(next: Workspace, p: Pending) { const ids = p.ids; if (!ids)
        return; let e = state.current.editors; if (p.body.command === 'save_opinion') {
        const r = next.staff?.opinions.find(o => o.id === ids[0]);
        if (r)
            e = { ...e, opinionId: r.id, opinionRevision: r.revision };
    } if (p.body.command === 'save_draft') {
        const r = next.staff?.drafts.find(o => o.id === ids[0]);
        if (r)
            e = { ...e, draftId: r.id, draftRevision: r.revision };
    } if (p.body.command === 'publish')
        e = { ...e, tab: 'public' }; state.current.editors = e; setEditors(e); mark(null); setPreview(null); setMessage('저장 결과를 확인했습니다. 제출·검토·업무 완료는 각각 별도입니다.'); }
    async function reread() { const p = state.current.pending; const next = await refresh(); if (next && p?.ids)
        reconcile(next, p); }
    async function execute(input?: CommandInput) {
        if (live.current.locked || !active(live.current.generation))
            return;
        const old = state.current.pending;
        if (old?.ids) {
            await reread();
            return;
        }
        if (old?.conflict) {
            setError('최신 기록을 비교하고 입력 유지 기준을 선택해 주세요.');
            return;
        }
        const p = old ?? (input ? { body: { ...input, taskId: initial.taskId, idempotencyKey: crypto.randomUUID() }, ids: null, conflict: false } as Pending : null);
        if (!p)
            return;
        const g = live.current.generation;
        live.current.locked = true;
        setBusy(true);
        setError('');
        setMessage('');
        mark(p);
        try {
            const result = await request<CorrectionCommandResult>('/api/corrections', p.body, () => active(g));
            if (!active(g))
                return;
            const committed = { ...p, ids: result.ids };
            mark(committed);
            setMessage('저장은 완료됐습니다. 확정 ID를 보관하고 최신 기록을 확인합니다.');
            const next = await refresh();
            if (next && active(g))
                reconcile(next, committed);
        }
        catch (e) {
            if (active(g)) {
                if (e instanceof CorrectionError && e.status === 409)
                    mark({ ...p, conflict: true });
                else if (e instanceof CorrectionError && e.status === 422)
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
    async function acceptCurrent() { const next = await refresh(); if (!next)
        return; let e = state.current.editors; if (e.opinionId) {
        const r = next.staff?.opinions.find(o => o.id === e.opinionId);
        if (r)
            e = { ...e, opinionRevision: r.revision };
    } if (e.draftId) {
        const r = next.staff?.drafts.find(o => o.id === e.draftId);
        if (r)
            e = { ...e, draftRevision: r.revision };
    } edit(e); mark(null); setMessage('작성값을 유지하고 최신 기록을 기준으로 선택했습니다. 내용을 비교한 뒤 다시 실행해 주세요.'); }
    async function showPreview() { const e = state.current.editors, stored = latest.current.staff?.drafts.find(d => d.id === e.draftId); if (!stored || stored.revision !== e.draftRevision || JSON.stringify(stored.draft) !== JSON.stringify(e.draft)) {
        setError('변경 내용을 먼저 저장한 뒤 미리보기해 주세요.');
        return;
    } const g = live.current.generation; setError(''); try {
        const value = await request<CorrectionPreview>(`/api/corrections/drafts/${stored.id}/preview`);
        if (active(g))
            setPreview({ draftId: stored.id, revision: stored.revision, value });
    }
    catch (e) {
        handle(e, g);
    } }
    const guarded = useCallback(async <T,>(work: (alive: () => boolean) => Promise<T>): Promise<T | null> => { const g = live.current.generation; try {
        const value = await work(() => active(g));
        return active(g) ? value : null;
    }
    catch (e) {
        handle(e, g);
        return null;
    } }, [active, handle]);
    function restore() { if (!recoverable || !active(live.current.generation))
        return; state.current = { editors: recoverable.editors, pending: recoverable.pending }; setEditors(recoverable.editors); setPending(recoverable.pending); setRecoverable(null); setMessage('작성값을 복구했습니다. 확정된 명령은 재조회만 하고, 결과를 모르는 명령은 같은 키와 내용으로 다시 확인합니다.'); persist(); }
    return { w, ready, editors, edit, busy, error, message, storageError, pending, recoverable, preview, refresh, reread, execute, acceptCurrent, showPreview, guarded, restore, discardRecovery: () => { setRecoverable(null); persist(); } };
}
export type Controller = ReturnType<typeof useCorrections>;
