import Link from "next/link";
import type { RequestContent } from "@/domain/tasks/types";
import { typeLabels } from "@/domain/tasks/types";
import type { TaskDetail, TaskCatalog } from "@/server/tasks/service";
import { DeadlineView } from "./deadline-editor";
import { milestoneLabels } from "./content-editor";
import s from "./ui.module.css";
export type PublicContent = Omit<RequestContent,"internalOriginal"|"internalMemo"> & Partial<Pick<RequestContent,"internalOriginal"|"internalMemo">>;
export function FileLinks({ file, taskId }: {file:TaskDetail["files"][number];taskId:string}) {
    const base=`/api/files/${encodeURIComponent(file.id)}?taskId=${encodeURIComponent(taskId)}`;
    return <div className={s.file}><div><strong>{file.name}</strong><div className={s.small}>{(file.bytes/1024).toFixed(1)} KiB · {file.preview?"미리보기 가능":"원본 다운로드 전용"} · {file.visibility==="internal"?"GSG 내부":"브랜드 공개"}</div></div><div className={s.row}><a className={s.link} href={`${base}&mode=download`}>다운로드</a>{file.preview&&<a className={s.link} href={`${base}&mode=preview`} target="_blank" rel="noreferrer">미리보기 ↗</a>}</div></div>;
}
export function RequestView({ content:c, catalog, files, taskId }: { content:PublicContent;catalog:TaskCatalog;files:TaskDetail["files"];taskId:string }) {
    const name=(id:string)=>catalog.members.find(x=>x.id===id)?.name??"이전 담당자";
    return <div className={s.stack}><section className={s.panel}><h2>{c.title}</h2><p className={s.prose}>{c.description||"설명이 없습니다."}</p><dl className={s.meta}>{([['purpose','목적'],['output','산출물'],['productionResponsibility','제작 주체'],['subtitleResponsibility','자막 책임'],['originalResponsibility','원본 제공 책임'],['usePlace','사용 장소'],['nextAction','다음 행동']] as const).filter(([k])=>c[k]).map(([k,l])=><div key={k} style={{display:"contents"}}><dt>{l}</dt><dd>{c[k]}</dd></div>)}</dl></section>
    <section className={s.panel}><h2>요청 항목 · {c.requirements.length}개</h2><div className={s.list}>{c.requirements.map(q=><article className={s.sub} key={q.key}><div className={s.row}><strong>{q.label}</strong><span className={s.badge}>{typeLabels[q.type]}</span><span className={s.required}>{q.required?"필수":"선택"}</span></div>{q.help&&<p className={s.prose}>{q.help}</p>}{q.options.length>0&&<p>선택지: {q.options.join(" / ")}</p>}{q.unit&&<p>단위: {q.unit}</p>}{q.condition&&<p className={s.small}>적용 조건: {c.requirements.find(x=>x.key===q.condition!.key)?.label??"선택 항목"} = {q.condition.equals}</p>}<p className={s.small}>적용 상품: {q.productIds.length?q.productIds.map(id=>catalog.products.find(p=>p.id===id)?.name??"상품 확인").join(", "):"공통"}</p>{q.specifications.map((x,i)=><p className={s.small} key={i}>{x.severity==="required"?"필수 규격":"권장 규격"} · {x.check==="human"?"사람 확인":"자동 형식 검사"}: {x.text} ({x.source} · {x.version})</p>)}</article>)}</div></section>
    <section className={s.panel}><h2>제출 기한</h2><DeadlineView value={c.deadline} name={name}/>{c.milestones.map(m=><div className={s.sub} key={m.id} style={{marginTop:16}}><h3>{milestoneLabels[m.kind]} · {m.visibility==="internal"?"내부":"공개"}</h3><p>확인 상대: {m.counterpart}</p><DeadlineView value={m.deadline} name={name}/></div>)}</section>
    <section className={s.panel}><h2>참고자료</h2><p className={s.hint}>GSG가 제공하는 양식·가이드입니다. 제출 결과물과 구분됩니다.</p>{c.referenceFileIds.length?files.filter(f=>c.referenceFileIds.includes(f.id)).map(f=><FileLinks key={f.id} file={f} taskId={taskId}/>):<p className={s.small}>등록한 참고파일이 없습니다.</p>}{c.links.map((l,i)=><p key={i}><a className={s.link} href={l.url} target="_blank" rel="noreferrer">{l.description} ↗</a><span className={s.small}> · 외부 링크·내용 미고정</span></p>)}</section>
    {catalog.products.length>0&&<section className={s.panel}><h2>상품정보</h2><div className={s.row}>{catalog.products.map(p=><Link prefetch={false} className={s.link} key={p.id} href={`/products/${p.id}?context=${encodeURIComponent(catalog.contexts.find(x=>x.id===catalog.tasks.find(t=>t.id===taskId)?.contextId)?.id??"")}`}>{p.name} ↗</Link>)}</div></section>}</div>;
}
