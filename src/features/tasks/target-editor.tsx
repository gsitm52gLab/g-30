"use client";
import type { TaskCatalog } from "@/server/tasks/service";
import s from "./ui.module.css";
export type Target = { contextId: string; ownerId: string; assigneeId: string; coAssigneeIds: string[]; productIds: string[] };
export function initialTarget(contextId: string, catalog: TaskCatalog): Target { return { contextId, ownerId: catalog.members.find(m => m.role === "gsg")?.id ?? "", assigneeId: catalog.members.find(m => m.role === "brand")?.id ?? "", coAssigneeIds: [], productIds: [] }; }
export function Checks({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
    return <fieldset className={s.sub}><legend>{label}</legend>{options.length ? <div className={s.choices}>{options.map(o => <label className={s.check} key={o.id}><input type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value,o.id] : value.filter(x => x !== o.id))}/>{o.name}</label>)}</div> : <p className={s.small}>선택 가능한 항목이 없습니다.</p>}</fieldset>;
}
export function TargetEditor({ value, onChange, catalog, products = true }: { value: Target; onChange: (t: Target) => void; catalog: TaskCatalog; products?: boolean }) {
    return <div className={s.stack}><div className={s.grid}>
        <label className={s.field}>GSG 책임자<select required value={value.ownerId} onChange={e => onChange({ ...value, ownerId:e.target.value })}><option value="">선택</option>{catalog.members.filter(m=>m.role==="gsg").map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className={s.field}>브랜드 주담당<select required value={value.assigneeId} onChange={e => onChange({ ...value, assigneeId:e.target.value, coAssigneeIds:value.coAssigneeIds.filter(id=>id!==e.target.value) })}><option value="">선택</option>{catalog.members.filter(m=>m.role==="brand").map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    </div><Checks label="공동담당 (선택)" options={catalog.members.filter(m=>m.role==="brand"&&m.id!==value.assigneeId)} value={value.coAssigneeIds} onChange={ids=>onChange({...value,coAssigneeIds:ids})}/>{products && <Checks label="대상 상품" options={catalog.products} value={value.productIds} onChange={ids=>onChange({...value,productIds:ids})}/>}</div>;
}
