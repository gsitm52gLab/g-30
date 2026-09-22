'use client';
import type {Data} from './model';
import {kinds,statusLabel} from './model';
import s from './ui.module.css';
export function Filters({data,query,audit,submit}:{data:Data|null;query:string;audit:boolean;submit:(q:URLSearchParams)=>void}){
 const q=new URLSearchParams(query),search=data?.type==='search'?data.value:null,audits=data?.type==='audit'?data.value:null,options=search?.filters??(data?.type==='audit'?data.options:null);
 const select=(name:string,label:string,choices:{value:string;label:string}[])=>{const selected=q.get(name)??'';return <label className={s.field}>{label}<select name={name} aria-label={label} defaultValue={selected}><option value="">전체</option>{selected&&!choices.some(x=>x.value===selected)&&<option value={selected}>선택 조건 · {selected}</option>}{choices.map(x=><option value={x.value} key={x.value}>{x.label}</option>)}</select></label>;};
 const text=(name:string,label:string,type='text')=><label className={s.field}>{label}<input aria-label={label} name={name} type={type} defaultValue={q.get(name)??''} maxLength={name==='q'?200:160}/></label>;
 return <form className={s.panel} aria-label={audit?'변경 기록 검색 조건':'자료 검색 조건'} onSubmit={e=>{e.preventDefault();const params=new URLSearchParams({context:q.get('context')??''});for(const [key,value] of new FormData(e.currentTarget))if(typeof value==='string'&&value)params.set(key,value);params.set('page','1');submit(params);}}>
 <div className={s.grid}>{text('q',audit?'작업·대상·변경 내용 검색':'제목·본문·파일명·담당 검색')}{!audit&&<label className={s.field}>조회 범위<select aria-label="조회 범위" name="mode" defaultValue={q.get('mode')??'current'}><option value="current">현재 자료</option><option value="history">과거 이력 포함</option></select></label>}
 {select('kind','자료 종류',(options?.kinds??[]).map(k=>({value:k,label:kinds[k]})))}{text('sku','SKU')}{text('jan','JAN')}{select('status',audit?'작업 유형':'상태',audit?(audits?.filters.actions??[]).map(x=>({value:x.value,label:x.label})):(options?.statuses??[]).map(k=>({value:k,label:statusLabel(k)})))}
 {select('actor','기록 작성자',(audit?audits?.filters.actors:options?.actors)?.map(x=>({value:x.id,label:x.label}))??[])}{select('assignee','현재 관련 업무 담당',(options?.assignees??[]).map(x=>({value:x.id,label:x.label})))}{text('from','기록 시작일','date')}{text('to','기록 종료일','date')}
 <label className={s.field}>페이지당 기록<select aria-label="페이지당 기록" name="pageSize" defaultValue={q.get('pageSize')??'20'}>{[...new Set([Number(q.get('pageSize')||20),10,20,50])].filter(v=>Number.isSafeInteger(v)&&v>0&&v<=50).map(v=><option key={v} value={v}>{v}건</option>)}</select></label>
 </div><details className={s.records}><summary>상품·업무 식별자로 좁히기</summary><div className={s.grid}>{text('product','상품 ID')}{text('task','업무 ID')}</div></details>
 <p className={s.muted}>기록 날짜는 UTC 기준입니다. 현재 관련 업무 담당은 과거 작성자와 별개입니다. SKU·JAN의 앞자리 0을 그대로 검색합니다.</p>
 <div className={s.actions}><button className={s.button} type="submit">검색·필터 적용</button><button className={`${s.button} ${s.secondary}`} type="button" onClick={()=>submit(new URLSearchParams({context:q.get('context')??''}))}>필터 해제</button></div>
 </form>;
}
