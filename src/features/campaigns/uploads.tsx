'use client';
import { useEffect, useRef, useState } from 'react';
import type { TaskDetail } from '@/server/tasks/service';
import type { Controller } from './controller';
import { request } from './client';
import s from './ui.module.css';
type Item = {
    id: string;
    file: File;
    state: 'ready' | 'failed' | 'done';
    error: string;
};
export function SourceUploads({ c, onUploaded }: {
    c: Controller;
    onUploaded: (files: TaskDetail['files']) => void;
}) {
    const [items, setItems] = useState<Item[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [visibility, setVisibility] = useState<'internal' | 'public'>('internal');
    const mounted = useRef(false), locked = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const alive = () => mounted.current && c.active();
    async function upload() { if (locked.current)
        return; locked.current = true; setBusy(true); setError(''); try {
        for (const item of items.filter(i => i.state !== 'done')) {
            if (!alive())
                return;
            const form = new FormData();
            form.append('files', item.file);
            form.append('visibility', visibility);
            try {
                const r = await request<{
                    files: TaskDetail['files'];
                }>(`/api/files?taskId=${encodeURIComponent(c.state.data!.task.task.id)}`, form, alive);
                if (!alive())
                    return;
                onUploaded(r.files);
                setItems(old => old.map(x => x.id === item.id ? { ...x, state: 'done', error: '' } : x));
            }
            catch (e) {
                c.failure(e);
                if (!alive())
                    return;
                setItems(old => old.map(x => x.id === item.id ? { ...x, state: 'failed', error: e instanceof Error ? e.message : '업로드 실패' } : x));
            }
        }
    }
    finally {
        locked.current = false;
        if (alive())
            setBusy(false);
    } }
    return <section className={s.sub}><h3>카탈로그·외부 원문 파일 업로드</h3><p className={s.hint}>원문 파일은 기본 GSG 내부입니다. 업로드만으로 공개 참고자료·제출·수령 기록이 되지 않습니다. 25MiB/개, 한 번에 10개.</p><fieldset disabled={busy || c.locked} className={s.fieldset}><label className={s.field}>원문 파일 선택<input type="file" multiple onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length > 10 || fs.some(f => f.size > 25 * 1024 * 1024)) {
        setError('파일은 10개 이하, 각 25MiB 이하로 선택해 주세요.');
        return;
    } setItems(fs.map(file => ({ id: crypto.randomUUID(), file, state: 'ready', error: '' }))); setError(''); }}/></label><label className={s.field}>업로드 파일 범위<select value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)}><option value="internal">GSG 내부</option><option value="public">공개 파일 (별도 요청 공개·제출 필요)</option></select></label><button type="button" className="button subtle" disabled={!items.some(i => i.state !== 'done')} onClick={upload}>{items.some(i => i.state === 'failed') ? '실패 파일만 재시도' : '선택한 원문 파일 업로드'}</button></fieldset>{error && <p role="alert">{error}</p>}{items.map(i => <p key={i.id}>{i.file.name} · {i.state === 'done' ? '업로드 완료' : i.state === 'failed' ? '업로드 실패' : '대기'} {i.error}</p>)}</section>;
}
