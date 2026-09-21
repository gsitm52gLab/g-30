'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { TaskCatalog } from '@/server/tasks/service';
import type { InquiryController } from './controller';
import { CreateTask } from '@/features/tasks/create';
import { api } from './client';
import s from './ui.module.css';
export function TaskLinker({ c }: {
    c: InquiryController;
}) {
    const [catalog, setCatalog] = useState<TaskCatalog | null>(null), [create, setCreate] = useState(false), [selected, setSelected] = useState('');
    const d = c.detail;
    if (!d || d.phase !== 'active' || !d.capabilities.linkTask)
        return null;
    const contextId = d.contextId, pending = c.recovery.pendingTaskId, linked = pending && d.task?.id === pending;
    async function load() { try {
        setCatalog(await api<TaskCatalog>(`/api/tasks?context=${contextId}`));
    }
    catch (e) {
        c.report(e);
    } }
    async function link(id: string) { const fresh = await c.refresh().catch(() => null); if (!fresh || fresh.phase !== 'active')
        return; const command = { command: 'link_task' as const, expectedRevision: fresh.revision, taskId: id, idempotencyKey: crypto.randomUUID() }; c.update({ linkIntent: command }); await c.run(command); }
    return <section className={`${s.panel} ${s.stack}`} aria-label="문의 업무 연결"><h2>문의와 요청 업무 연결</h2><p className={s.meta}>대화는 원래 문의에 남습니다. 문의 참여자는 업무 배정으로 이전되지 않습니다. 업무 공개·수락·제출은 별도입니다.</p>{pending ? <div className={s.notice}><h3>{linked ? '만든 업무를 연결했습니다' : '이미 만든 업무 · 문의 연결 확인 필요'}</h3><Link href={`/tasks/${pending}?context=${contextId}`}>생성한 업무 열기 ↗</Link>{!linked && <button className="button subtle" disabled={c.busy || !!c.recovery.committed} onClick={() => void link(pending)}>이미 만든 업무 연결만 다시 시도</button>}</div> : <><button className="button subtle" disabled={c.busy} onClick={() => void load()}>연결할 업무 불러오기</button>{catalog && <><div className={s.row}><label className={s.field}>기존 요청 업무<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">현재 허용된 업무 선택</option>{catalog.tasks.map(t => <option key={t.id} value={t.id}>{t.data.title}</option>)}</select></label><button className="button subtle" disabled={!selected || c.busy || !!c.recovery.intent} onClick={() => void link(selected)}>기존 업무 연결</button></div><button className="button subtle" onClick={() => setCreate(v => !v)}>이 문의에서 요청 업무 만들기</button>{create && <section aria-label="문의 연결 업무 만들기"><CreateTask catalog={catalog} contextId={contextId} singleContext onCreated={async (r) => { const id = r.ids[0]; c.update({ pendingTaskId: id }); setCreate(false); await link(id); }}/></section>}</>}</>}</section>;
}
