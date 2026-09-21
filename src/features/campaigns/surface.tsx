'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaign } from './controller';
import { type Workspace, taskHref } from './model';
import { Catalogs } from './catalogs';
import { Editor } from './editor';
import { Progress } from './public-view';
import { Participation, External, Physical, Followup } from './actions';
import s from './ui.module.css';
export function CampaignSurface({ initial, selection, version }: {
    initial: Workspace;
    selection: string | null;
    version: string | null;
}) {
    const router = useRouter(), c = useCampaign(initial, selection, version), { state } = c, [tab, setTab] = useState(selection ? 'public' : 'list');
    const d = state.data, detail = d?.detail;
    const path = `/tasks/${initial.task.task.id}/campaigns?context=${initial.task.task.contextId}`;
    if (state.denied || !d)
        return <section className={s.panel} role="alert"><h1>행사 자료를 열 수 없습니다</h1><p>{state.error}</p><Link href="/login">로그인 확인</Link></section>;
    return <div className={s.stack}><Link className="back-link" href={taskHref(d.task.task.id, d.task.task.contextId!)}>← 업무 상세</Link><header className={s.hero}><p>GS HALE · PR·행사</p><h1>{d.task.task.data.title}</h1><p>참여 선택부터 준비물, 실물 발송과 결과 자료까지</p></header>{state.error && <section className={s.error} role="alert"><p>{state.error}</p><p>작성한 값은 유지했습니다. 현재 공개 조건·요청과 비교해 주세요.</p><button type="button" className="button subtle" disabled={state.busy} onClick={() => void c.refresh()}>현재 저장본 다시 확인</button></section>}{state.message && <p role="status" className={s.success}>{state.message}</p>}{!state.ready && <p role="status">현재 권한과 저장된 내용을 확인하는 중입니다.</p>}{state.recovery.pending && <section className={s.notice}><h2>{state.recovery.pending.ids ? '저장은 완료됐습니다' : '처리 결과 확인이 필요합니다'}</h2>{state.recovery.pending.ids ? <><p>다시 저장하지 않고 조회만 재시도합니다. 완료된 기록 식별자를 보존했습니다.</p><details><summary>완료된 기록</summary><p className={s.hint}>{state.recovery.pending.ids.join(' · ')}</p></details></> : <p>같은 내용과 같은 요청 키로 재시도해 중복 기록을 방지합니다.</p>}<button className="button" disabled={state.busy} onClick={() => void c.execute()}>{state.recovery.pending.ids ? '저장된 결과 다시 조회' : '동일 요청으로 결과 확인'}</button></section>}
 <nav aria-label="행사 화면" className={s.tabs}>{(['list', 'public', ...(d.task.canManage ? ['catalogs', 'edit'] : []), ...(detail?.selected ? ['actions'] : [])] as const).map(x => <button key={x} type="button" className="button subtle" disabled={state.busy || !!state.recovery.pending} aria-pressed={tab === x} onClick={() => setTab(x)}>{({ list: '행사 목록', public: '공개 조건·진행', catalogs: '카탈로그', edit: '내부 초안', actions: '참여·사실 기록' } as Record<string, string>)[x]}</button>)}</nav>
 {tab === 'list' && <section className={s.panel}><h2>이 업무의 행사</h2>{d.list.items.length ? <div className={s.stack}>{d.list.items.map(x => <article className={s.sub} key={x.id}><h3><Link href={`${path}&campaign=${encodeURIComponent(x.id)}`}>{x.title || '제목 없는 초안'}</Link></h3><span className={s.badge}>{x.state === 'draft' ? 'GSG 비공개 초안' : '공개 조건 있음'}</span><p>{x.recordedAt ?? '아직 공개하지 않음'}</p></article>)}</div> : <div className={s.empty}><h3>아직 등록된 행사가 없습니다</h3><p>{d.task.canManage ? '카탈로그 원문과 실제 업무 요청 항목을 준비한 뒤 행사 초안을 작성하세요.' : 'GSG가 행사 조건을 공개하면 여기에서 확인할 수 있습니다.'}</p></div>}{d.task.canManage && <div className={s.actions}>{detail ? <Link className="button" href={path}>새 행사 작성 화면</Link> : <button className="button" disabled={c.locked} onClick={() => setTab('edit')}>새 행사 초안 작성</button>}<button className="button subtle" disabled={c.locked} onClick={() => setTab('catalogs')}>카탈로그 등록·관리</button></div>}</section>}
 {detail && tab !== 'list' && <section className={s.panel}><label className={s.field}>공개 행사 버전<select value={detail.selected?.id ?? ''} disabled={c.locked} onChange={e => { router.push(`${path}&campaign=${detail.id}${e.target.value ? '&version=' + e.target.value : ''}`); }}><option value="">현재 공개본</option>{detail.versions.map(v => <option key={v.id} value={v.id}>v{v.sequence} · {v.title} · {v.recordedAt}{v.id === detail.currentVersionId ? ' · 현재' : ''}</option>)}</select></label>{detail.selected && <p className={s.hint}>현재 업무 요청은 별도로 최신 버전을 확인합니다. 과거 공개·제출 내용은 당시 버전 그대로 표시합니다.</p>}</section>}
 {tab === 'public' && <Progress c={c}/>} {tab === 'catalogs' && d.task.canManage && <Catalogs c={c}/>} {tab === 'edit' && d.task.canManage && <Editor c={c}/>}
 {tab === 'actions' && detail?.selected && <div className={s.stack}><Participation c={c}/>{detail.capabilities.recordExternal && <External c={c}/>}<Physical c={c}/><Followup c={c}/></div>}
 </div>;
}
