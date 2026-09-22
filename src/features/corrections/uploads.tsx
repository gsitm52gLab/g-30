'use client';
import { useRef, useState, useEffect } from 'react';
import type { Controller } from './controller';
import { request, denied } from './client';
import { Checks } from './fields';
import { CorrectionFile as SubmissionFile } from './file-view';
import s from './ui.module.css';
type Row = {
    key: string;
    name: string;
    status: 'pending' | 'ready' | 'failed';
    error: string;
    fileId?: string;
};
export function InternalFiles({ c, selected, onChange }: {
    c: Controller;
    selected: string[];
    onChange: (ids: string[]) => void;
}) {
    const [rows, setRows] = useState<Row[]>([]), [busy, setBusy] = useState(false), files = useRef(new Map<string, File>()), mounted = useRef(true), latest = useRef({ rows, selected, onChange });
    latest.current = { rows, selected, onChange };
    useEffect(() => { const memory = files.current; mounted.current = true; return () => { mounted.current = false; memory.clear(); }; }, []);
    const w = c.w!;
    async function upload(failedOnly = false) { if (busy)
        return; setBusy(true); const pending = latest.current.rows.filter(r => r.status === (failedOnly ? 'failed' : 'pending')); await c.guarded(async (alive) => { for (const row of pending) {
        const file = files.current.get(row.key);
        if (!file || !mounted.current || !alive())
            break;
        try {
            if (file.size > 25 * 1024 * 1024)
                throw new Error('파일당 최대 25 MiB입니다.');
            const form = new FormData();
            form.append('files', file);
            form.append('visibility', 'internal');
            const result = await request<{
                files: {
                    id: string;
                }[];
            }>(`/api/files?taskId=${w.taskId}`, form, () => mounted.current && alive());
            if (!mounted.current || !alive())
                return;
            const id = result.files[0].id;
            setRows(v => v.map(r => r.key === row.key ? { ...r, status: 'ready', fileId: id, error: '' } : r));
            files.current.delete(row.key);
            latest.current.onChange([...new Set([...latest.current.selected, id])]);
            await c.refresh();
            if (!alive())
                return;
        }
        catch (e) {
            if (denied(e))
                throw e;
            if (!mounted.current || !alive())
                return;
            setRows(v => v.map(r => r.key === row.key ? { ...r, status: 'failed', error: e instanceof Error ? e.message : '업로드를 확인하지 못했습니다.' } : r));
        }
    } }); if (mounted.current)
        setBusy(false); }
    return <section className={s.sub}><h3>내부 근거 파일</h3><p className={s.hint}>GSG 내부 파일입니다. 공개 설명이나 브랜드 파일로 자동 전환되지 않습니다. 한 번에 최대 10개, 파일당 25 MiB입니다.</p><label className={s.field}>내부 파일 선택<input type="file" multiple disabled={busy} onChange={e => { const chosen = Array.from(e.target.files ?? []); if (chosen.length > 10) {
        setRows(v => [...v, { key: crypto.randomUUID(), name: '선택 한도', status: 'failed', error: '한 번에 최대 10개를 선택해 주세요.' }]);
        return;
    } const added = chosen.map(f => { const key = crypto.randomUUID(); files.current.set(key, f); return { key, name: f.name, status: 'pending' as const, error: '' }; }); setRows(v => [...v, ...added]); e.target.value = ''; }}/></label><ul className={s.list}>{rows.map(r => <li key={r.key} aria-label={`업로드 · ${r.name}`}><strong>{r.name}</strong> · {r.status === 'ready' ? '파일 저장 완료' : r.status === 'failed' ? '업로드 실패' : '업로드 대기'}{r.error && <p className={s.error}>{r.error}</p>}{r.status === 'failed' && <label className={s.field}>이 파일 다시 선택<input type="file" onChange={e => { const f = e.target.files?.[0]; if (f) {
        files.current.set(r.key, f);
        setRows(v => v.map(x => x.key === r.key ? { ...x, name: f.name, status: 'pending', error: '' } : x));
    } }}/></label>}</li>)}</ul><div className={s.actions}><button className="button subtle" type="button" disabled={busy || !rows.some(r => r.status === 'pending')} onClick={() => void upload()}>대기 파일 업로드</button><button className="button subtle" type="button" disabled={busy || !rows.some(r => r.status === 'failed' && files.current.has(r.key))} onClick={() => void upload(true)}>실패 파일만 재시도</button></div><Checks label="연결할 내부 파일" options={(w.staff?.internalFiles ?? []).map(f => ({ id: f.id, label: `${f.name} · ${f.id}` }))} value={selected} onChange={onChange}/>{w.staff?.internalFiles.filter(f => selected.includes(f.id)).map(f => <SubmissionFile file={f} key={f.id}/>)}</section>;
}
