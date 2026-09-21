'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationDetailDTO, InquiryCommand, InquiryCommandResult, InquiryUploadResult, StaffInquiryEvent } from '@/server/inquiries/contracts';
import { api, actor, changed, denied, errorText, RequestError, deniedEvent } from './client';
import { blank, clearAll, keyFor, read, save, type Recovery, type FileItem } from './recovery';
export function useInquiry(id: string, contextId: string) {
    const [detail, setDetail] = useState<ConversationDetailDTO | null>(null), [recovery, setRecovery] = useState<Recovery>(blank), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [connection, setConnection] = useState('권한 확인 중');
    const state = useRef(recovery), current = useRef<ConversationDetailDTO | null>(null), key = useRef(''), user = useRef(''), locked = useRef(false), alive = useRef(true), halted = useRef(false), files = useRef(new Map<string, File>()), restore = useRef(false), loadSequence = useRef(0);
    const update = useCallback((patch: Partial<Recovery>) => { const next = { ...state.current, ...patch, at: Date.now() }; state.current = next; setRecovery(next); if (key.current && !halted.current)
        save(key.current, next); }, []);
    const purge = useCallback(() => { halted.current = true; key.current = ''; user.current = ''; current.current = null; state.current = blank(); files.current.clear(); clearAll(); setRecovery(blank()); setDetail(null); setBlocked(true); setConnection('현재 권한 확인 필요'); setError('현재 권한으로 문의를 볼 수 없습니다. 보호된 대화와 작성 내용을 지웠습니다.'); }, []);
    const report = useCallback((e: unknown) => { if (denied(e))
        purge();
    else if (alive.current)
        setError(errorText(e)); }, [purge]);
    const refresh = useCallback(async () => {
        const sequence = ++loadSequence.current;
        try {
            const who = await actor();
            if (user.current && who !== user.current) {
                purge();
                throw new RequestError('계정이 변경되었습니다. 다시 접속해 주세요.', 401, 'ACCOUNT_CHANGED');
            }
            const fresh = await api<ConversationDetailDTO>(`/api/inquiries/${encodeURIComponent(id)}`);
            if (fresh.contextId !== contextId)
                throw new RequestError('현재 컨텍스트에서 문의를 찾을 수 없습니다.', 404, 'NOT_FOUND');
            if (!alive.current || halted.current || sequence !== loadSequence.current)
                return fresh;
            user.current = who;
            key.current = keyFor(who, contextId, id);
            current.current = fresh;
            setDetail(fresh);
            if (!restore.current) {
                restore.current = true;
                const old = read(key.current);
                if (old) {
                    const allowed = fresh.phase === 'draft' ? fresh.files : fresh.readyFiles;
                    const recovered = old.files.map(f => { const file = allowed.find(a => a.id === f.file?.id); return file ? { ...f, state: 'ready' as const, file } : { ...f, state: 'failed' as const, file: undefined, error: '파일을 다시 선택해 주세요. 파일 내용은 브라우저에 보관하지 않습니다.' }; });
                    update({ ...old, files: recovered });
                    setNotice('현재 권한을 확인하고 이 브라우저의 작성 내용을 복구했습니다.');
                }
                else
                    update({ mode: fresh.phase === 'draft' ? 'question' : 'comment' });
            }
            return fresh;
        }
        catch (e) {
            report(e);
            throw e;
        }
    }, [contextId, id, purge, report, update]);
    useEffect(() => { alive.current = true; halted.current = false; void refresh().catch(() => { }); const onDenied = () => purge(); const focus = () => { if (!halted.current)
        void refresh().catch(() => { }); }; window.addEventListener(deniedEvent, onDenied); window.addEventListener('focus', focus); return () => { alive.current = false; window.removeEventListener(deniedEvent, onDenied); window.removeEventListener('focus', focus); }; }, [purge, refresh]);
    const phase = detail?.phase;
    useEffect(() => {
        if (phase !== 'active' || blocked)
            return;
        let stopped = false, stream: EventSource | null = null, timer: ReturnType<typeof setTimeout> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
        let cursor = current.current?.phase === 'active' ? current.current.cursor : '';
        async function recover() { if (stopped || halted.current)
            return; setConnection('연결 끊김 · 현재 권한과 누락 대화 확인 중'); try {
            const fresh = await refresh();
            if (stopped || halted.current)
                return;
            if (fresh.phase === 'active') {
                cursor = fresh.cursor;
                connect();
            }
        }
        catch {
            if (!stopped && !halted.current)
                timer = setTimeout(recover, 2500);
        } }
        function connect() { if (stopped || halted.current)
            return; stream?.close(); stream = new EventSource(`/api/inquiries/${encodeURIComponent(id)}/stream?after=${encodeURIComponent(cursor)}`); stream.onopen = () => { if (!stopped)
            setConnection('실시간 연결됨'); }; stream.addEventListener('inquiry', event => { try {
            const frame = JSON.parse((event as MessageEvent).data) as StaffInquiryEvent;
            if (typeof frame.cursor !== 'string')
                throw new Error('연결 응답을 확인하지 못했습니다.');
            cursor = frame.cursor;
            if (debounce)
                clearTimeout(debounce);
            debounce = setTimeout(() => { void refresh().then(d => { if (d.phase === 'active')
                cursor = d.cursor; changed(); }).catch(() => { }); }, 40);
        }
        catch (e) {
            report(e);
            stream?.close();
            timer = setTimeout(recover, 1200);
        } }); stream.addEventListener('unavailable', event => { stream?.close(); try {
            const value = JSON.parse((event as MessageEvent).data);
            if (['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].includes(value.code ?? value.error?.code)) {
                purge();
                return;
            }
        }
        catch { } timer = setTimeout(recover, 100); }); stream.onerror = () => { stream?.close(); if (!stopped && !halted.current)
            timer = setTimeout(recover, 1200); }; }
        connect();
        return () => { stopped = true; stream?.close(); if (timer)
            clearTimeout(timer); if (debounce)
            clearTimeout(debounce); };
    }, [phase, blocked, id, refresh, report, purge]);
    async function finish(command: InquiryCommand | null) { await refresh(); if (!alive.current || halted.current)
        return; if (command && 'content' in command) {
        files.current.clear();
        update({ body: '', files: [], intent: null, committed: null, title: '', questionId: '', mode: 'comment' });
    }
    else
        update({ intent: null, committed: null }); setError(''); setNotice('서버에 기록했습니다. 업무 수락·제출·완료와는 별도입니다.'); changed(); }
    async function run(command: InquiryCommand) { if (locked.current || halted.current || state.current.committed)
        return; locked.current = true; setBusy(true); setError(''); setNotice(''); update({ intent: command }); try {
        const result = await api<InquiryCommandResult>(`/api/inquiries/${id}`, { ...command });
        update({ committed: result });
        await finish(command);
    }
    catch (e) {
        report(e);
    }
    finally {
        locked.current = false;
        setBusy(false);
    } }
    async function reread() { if (locked.current || halted.current)
        return; locked.current = true; setBusy(true); try {
        await finish(state.current.intent);
    }
    catch (e) {
        report(e);
    }
    finally {
        locked.current = false;
        setBusy(false);
    } }
    async function prepareNewAttempt() { try {
        await refresh();
        if (!halted.current) {
            update({ intent: null });
            setError('');
            setNotice('최신 상태를 확인했습니다. 작성값을 유지했으므로 기록 여부를 확인한 뒤 새 의도로 전송하세요.');
        }
    }
    catch (e) {
        report(e);
    } }
    async function upload(selected: FileItem[]) { if (locked.current || halted.current)
        return; locked.current = true; setBusy(true); setError(''); try {
        const candidates = selected.filter(f => f.state !== 'ready' && files.current.has(f.clientItemId));
        if (!candidates.length) {
            setError('실패한 파일을 다시 선택해 주세요.');
            return;
        }
        const form = new FormData();
        for (const f of candidates) {
            form.append('files', files.current.get(f.clientItemId)!);
            form.append('clientItemIds', f.clientItemId);
        }
        const visibility = state.current.mode === 'internal_note' ? 'internal' : 'public';
        const result = await api<{
            items: InquiryUploadResult[];
        }>(`/api/inquiries/${id}/files?visibility=${visibility}`, form);
        update({ files: state.current.files.map(f => { const item = result.items.find(x => x.clientItemId === f.clientItemId); return !item ? f : item.state === 'ready' ? { ...f, state: 'ready', file: item.file, error: undefined } : { ...f, state: 'failed', error: item.error.message }; }) });
    }
    catch (e) {
        report(e);
        if (!halted.current)
            update({ files: state.current.files.map(f => selected.some(x => x.clientItemId === f.clientItemId) && f.state !== 'ready' ? { ...f, state: 'failed', error: errorText(e) } : f) });
    }
    finally {
        locked.current = false;
        setBusy(false);
    } }
    async function choose(input: FileList | null, reselect?: string) { if (!input || halted.current)
        return; try {
        const chosen = [...input];
        if (!reselect && state.current.files.length + chosen.length > 10)
            throw Error('한 번에 파일 10개까지 선택할 수 있습니다.');
        const additions: FileItem[] = [];
        for (const file of chosen) {
            if (file.size > 25 * 1024 * 1024)
                throw Error('파일마다 25 MiB까지 업로드할 수 있습니다.');
            const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
            const old = reselect ? state.current.files.find(f => f.clientItemId === reselect) : null;
            if (old && (old.name !== file.name || old.type !== file.type || old.bytes !== file.size || old.sha256 !== sha256))
                throw Error('실패한 항목과 이름·형식·내용이 같은 파일을 선택해 주세요. 다른 파일은 명시적으로 제외한 뒤 추가하세요.');
            const f: FileItem = { clientItemId: old?.clientItemId ?? crypto.randomUUID(), name: file.name, type: file.type, bytes: file.size, sha256, state: 'pending' };
            files.current.set(f.clientItemId, file);
            additions.push(f);
        }
        update({ files: reselect ? state.current.files.map(f => additions.find(a => a.clientItemId === f.clientItemId) ?? f) : [...state.current.files, ...additions] });
        await upload(additions);
    }
    catch (e) {
        report(e);
    } }
    function send() {
        const d = current.current, r = state.current;
        if (!d)
            return;
        if (r.intent) {
            void run(r.intent);
            return;
        }
        if (r.files.some(f => f.state !== 'ready')) {
            setError('실패한 파일을 재시도하거나 명시적으로 제외한 뒤 전송하세요.');
            return;
        }
        if (r.files.some(f => f.file?.visibility !== (r.mode === 'internal_note' ? 'internal' : 'public'))) {
            setError('내부 파일과 공개 첨부를 섞을 수 없습니다. 해당 파일을 제외한 뒤 전송하세요.');
            return;
        }
        const content = { clientMessageId: crypto.randomUUID(), body: r.body, fileVersionIds: r.files.map(f => f.file!.id) }, idempotencyKey = crypto.randomUUID();
        let cmd: InquiryCommand;
        if (d.phase === 'draft')
            cmd = { command: 'publish_first', expectedRevision: d.revision, title: r.title, content, idempotencyKey };
        else if (r.mode === 'question')
            cmd = { command: 'question', expectedRevision: d.revision, content, idempotencyKey };
        else if (r.mode === 'answer' || r.mode === 'supplement') {
            const q = d.questions.find(q => q.id === r.questionId);
            if (!q) {
                setError('답변 또는 보완할 질문을 명시적으로 선택해 주세요.');
                return;
            }
            cmd = { command: r.mode, questionId: q.id, expectedQuestionRevision: q.revision, content, idempotencyKey };
        }
        else if (r.mode === 'internal_note')
            cmd = { command: 'internal_note', questionId: r.questionId || null, content, idempotencyKey };
        else
            cmd = { command: 'message', kind: r.mode, questionId: r.questionId || null, content, idempotencyKey };
        void run(cmd);
    }
    return { detail, recovery, update, error, setError, notice, busy, blocked, connection, refresh, report, run, reread, prepareNewAttempt, choose, upload, send };
}
export type InquiryController = ReturnType<typeof useInquiry>;
