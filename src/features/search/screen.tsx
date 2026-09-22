'use client';
import Link from 'next/link';
import {useEffect,useRef} from 'react';
import {useRouter} from 'next/navigation';
import type {Initial} from './model';
import {canAudit} from './model';
import {useRead} from './controller';
import {Filters} from './filters';
import {HitCard,HistoryView} from './views';
import {AuditCard,AuditDetail} from '@/features/audit/views';
import s from './ui.module.css';
export function SearchScreen({initial}:{initial:Initial}){
 const router=useRouter(),c=useRead(initial),audit=initial.view==='audit'||initial.view==='audit-detail',detail=initial.view==='history'||initial.view==='audit-detail';const errorRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(c.error)errorRef.current?.focus();},[c.error]);
 const paged=c.data?.type==='search'||c.data?.type==='audit'?c.data.value:null;
 const changeContext=(context:string)=>{if(detail)router.push(`/search?${new URLSearchParams({context})}`);else c.navigate(new URLSearchParams({context}));};
 const page=(n:number)=>{const p=new URLSearchParams(c.query);p.set('page',String(n));c.navigate(p);};
 return <div className={s.root} data-g14-view={initial.view}><header className={s.heading}><div><p className="eyebrow">{audit?'CHANGE HISTORY':'SEARCH & RECORDS'}</p><h1>{initial.view==='history'?'선택한 기록':initial.view==='audit-detail'?'변경 기록 상세':audit?'변경 기록':'검색·이력'}</h1><p className={s.muted}>{audit?'누가 무엇을 바꿨는지, 저장된 출처와 변경 전후를 확인합니다.':'현재 열람 가능한 자료와 과거 버전을 찾습니다.'}</p></div>{!c.denied&&c.scope&&<nav className={s.actions} aria-label="검색·감사 메뉴"><Link prefetch={false} className={`${s.button} ${s.secondary}`} href={`/search?${new URLSearchParams({context:c.context})}`}>자료 검색</Link>{canAudit(c.data)&&<Link prefetch={false} className={`${s.button} ${s.secondary}`} href={`/audit?${new URLSearchParams({context:c.context})}`}>변경 기록</Link>}</nav>}</header>
 {!c.denied&&c.scope&&<section className={s.context} aria-label="검색 컨텍스트"><label className={s.field}>조회 컨텍스트<select aria-label="조회 컨텍스트" value={c.context} onChange={e=>changeContext(e.target.value)}>{c.scope.contexts.map(ctx=><option key={ctx.id} value={ctx.id}>{ctx.data.country} / {ctx.data.retailer} / {ctx.data.brand}{ctx.data.eventName?` / ${ctx.data.eventName}`:''}</option>)}</select></label><p className={s.muted}>이 화면의 조회는 업무 읽음·알림 발송을 기록하지 않습니다.</p></section>}
 {!c.denied&&!detail&&c.scope&&c.context&&<Filters key={c.query} query={c.query} data={c.data} audit={audit} submit={c.navigate}/>}
 {c.error&&<div ref={errorRef} tabIndex={-1} role="alert" className={s.error}><strong>{c.denied?'현재 기록을 열 수 없습니다':'자료를 불러오지 못했습니다'}</strong><p>{c.error.message}</p>{c.denied?<Link href="/login">로그인과 조회 권한 확인</Link>:<><p>입력한 검색 조건은 유지됩니다. 조회 실패는 검색 결과 0건과 다릅니다.</p><button className={`${s.button} ${s.secondary}`} onClick={()=>void c.refresh()}>같은 조건으로 다시 조회</button></>}</div>}
 {c.busy&&<p role="status" className={s.muted}>현재 권한과 기록을 확인하고 있습니다…</p>}
 {!c.denied&&c.scope&&!c.scope.contexts.length&&<section className={s.empty}><h2>조회 가능한 컨텍스트가 없습니다</h2><p>현재 계정의 담당 범위를 확인해 주세요.</p></section>}
 {paged&&<><p className={s.resultCount} role="status">조회 가능한 {audit?'변경 기록':'기록·버전'} {paged.total}건 · {paged.page} / {Math.max(1,paged.pages)}페이지</p>{!audit&&<p className={s.muted}>건수는 고유 상품 수가 아닌 기록·버전 수입니다. 같은 상품의 공통 정보·컨텍스트·가격은 별도 기록일 수 있습니다.</p>}{paged.items.length===0?<section className={s.empty}><h2>{paged.total?'이 페이지에는 결과가 없습니다':'조건에 맞는 결과가 없습니다'}</h2><p>조건을 바꾸거나 이전 페이지를 확인하세요.</p></section>:<div className={s.list} aria-label={audit?'변경 기록 결과':'검색 결과'}>{c.data?.type==='search'?c.data.value.items.map(item=><HitCard key={item.key} item={item}/>):c.data?.type==='audit'?c.data.value.items.map(item=><AuditCard key={item.id} item={item} context={c.context}/>):null}</div>}<nav aria-label="검색 결과 페이지" className={s.actions}><button className={`${s.button} ${s.secondary}`} disabled={paged.page<=1} onClick={()=>page(paged.page-1)}>이전 페이지</button><span>{paged.page}페이지</span><button className={`${s.button} ${s.secondary}`} disabled={paged.page>=paged.pages} onClick={()=>page(paged.page+1)}>다음 페이지</button></nav></>}
 {c.data?.type==='history'&&<HistoryView data={c.data.value}/>} {c.data?.type==='audit-detail'&&<AuditDetail item={c.data.value}/>}
 {!c.denied&&c.scope&&c.context&&<div className={s.actions}><button className={`${s.button} ${s.secondary}`} onClick={()=>void c.refresh()} disabled={c.busy}>현재 기록 다시 확인</button>{detail&&<button className={`${s.button} ${s.secondary}`} onClick={()=>window.history.back()}>이전 화면으로</button>}</div>}
 </div>;
}
