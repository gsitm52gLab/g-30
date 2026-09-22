"use client";
import { blankRequirement, requirementTypes, typeLabels, type Requirement, type RequirementType } from "@/domain/tasks/types";
import { Checks } from "./target-editor";
import s from "./ui.module.css";
export function RequirementEditor({ value, onChange, products }: { value: Requirement[]; onChange:(r:Requirement[])=>void; products:{id:string;name:string}[] }) {
    const update = (i:number, patch:Partial<Requirement>)=>onChange(value.map((r,n)=>n===i?{...r,...patch}:r));
    return <section className={s.stack}><div><h2>요청 항목</h2><p className={s.hint}>참고자료와 별개로 브랜드가 답변하거나 제출할 항목입니다. 제품을 고르지 않은 항목은 공통 요청입니다.</p></div>
    {value.map((q,i)=><fieldset className={s.sub} key={q.key}><legend>항목 {i+1} · {typeLabels[q.type]}</legend><div className={s.grid}>
        <label className={s.field}>항목 제목<input required value={q.label} maxLength={200} onChange={e=>update(i,{label:e.target.value})}/></label>
        <label className={s.field}>응답 유형<select value={q.type} onChange={e=>update(i,{type:e.target.value as RequirementType})}>{requirementTypes.map(t=><option key={t} value={t}>{typeLabels[t]}</option>)}</select></label>
        <label className={`${s.field} ${s.wide}`}>작성 안내<textarea value={q.help} maxLength={2000} onChange={e=>update(i,{help:e.target.value})}/></label>
        <label className={s.check}><input type="checkbox" checked={q.required} onChange={e=>update(i,{required:e.target.checked})}/>필수 항목</label>
        {(q.type==="number"||q.type==="physical_record")&&<label className={s.field}>단위<input value={q.unit} onChange={e=>update(i,{unit:e.target.value})} maxLength={100}/></label>}
        {q.type==="choice"&&<label className={`${s.field} ${s.wide}`}>선택지 (한 줄에 하나)<textarea required value={q.options.join("\n")} onChange={e=>update(i,{options:e.target.value.split("\n")})}/></label>}
        <label className={s.field}>적용 조건<select value={q.condition?.key??""} onChange={e=>update(i,{condition:e.target.value?{key:e.target.value,equals:""}:null})}><option value="">항상 적용</option>{value.filter(r=>r.key!==q.key&&r.type==="choice").map(r=><option key={r.key} value={r.key}>{r.label||"제목 없는 선택 항목"}</option>)}</select></label>
        {q.condition&&<label className={s.field}>조건에 맞는 선택값<select required value={q.condition.equals} onChange={e=>update(i,{condition:{key:q.condition!.key,equals:e.target.value}})}><option value="">선택</option>{value.find(r=>r.key===q.condition!.key)?.options.map((o,n)=><option key={n} value={o}>{o}</option>)}</select></label>}
        <div className={s.wide}><Checks label="제품별 적용 범위" options={products} value={q.productIds} onChange={ids=>update(i,{productIds:ids})}/></div>
    </div><div className={s.stack} style={{marginTop:16}}>{q.specifications.map((spec,j)=><fieldset className={s.sub} key={j}><legend>규격 {j+1}</legend><div className={s.grid}>{([['text','규격 내용'],['source','규격 출처'],['version','출처 버전']] as const).map(([k,l])=><label className={s.field} key={k}>{l}<input required value={spec[k]} onChange={e=>update(i,{specifications:q.specifications.map((x,n)=>n===j?{...x,[k]:e.target.value}:x)})}/></label>)}
        <label className={s.field}>규격 강도<select value={spec.severity} onChange={e=>update(i,{specifications:q.specifications.map((x,n)=>n===j?{...x,severity:e.target.value as "required"|"recommended"}:x)})}><option value="required">필수</option><option value="recommended">권장</option></select></label>
        <label className={s.field}>확인 방법<select value={spec.check} onChange={e=>update(i,{specifications:q.specifications.map((x,n)=>n===j?{...x,check:e.target.value as "auto"|"human"}:x)})}><option value="auto">자동 형식 검사</option><option value="human">사람 확인</option></select></label>
    </div><button type="button" className="button subtle" onClick={()=>update(i,{specifications:q.specifications.filter((_,n)=>n!==j)})}>규격 삭제</button></fieldset>)}</div>
    <div className={s.actions}><button type="button" className="button subtle" onClick={()=>update(i,{specifications:[...q.specifications,{text:"",source:"",version:"",severity:"required",check:"human"}]})}>규격 추가</button><button type="button" className="button subtle" onClick={()=>onChange(value.filter((_,n)=>n!==i))}>항목 삭제</button>{i>0&&<button type="button" className="button subtle" onClick={()=>{const next=[...value];[next[i-1],next[i]]=[next[i],next[i-1]];onChange(next);}}>위로 이동</button>}</div></fieldset>)}
    <button className="button subtle" type="button" onClick={()=>onChange([...value,blankRequirement(`item-${crypto.randomUUID()}`)])}>요청 항목 추가</button></section>;
}
