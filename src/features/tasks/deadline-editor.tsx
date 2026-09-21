"use client";
import type { Deadline } from "@/domain/tasks/types";
import { certaintyLabels } from "@/domain/tasks/types";
import type { TaskCatalog } from "@/server/tasks/service";
import s from "./ui.module.css";
export function DeadlineEditor({ value, onChange, members, label = "제출 기한" }: { value: Deadline; onChange: (d: Deadline) => void; members: TaskCatalog["members"]; label?: string }) {
    const set = <K extends keyof Deadline>(key: K, v: Deadline[K]) => onChange({ ...value, [key]: v });
    return <fieldset className={s.sub}><legend>{label}</legend><div className={s.grid}>
        <label className={s.check}><input type="checkbox" checked={value.value === null} onChange={e => set("value", e.target.checked ? null : "")}/>기한 미정</label>
        <label className={s.field}>날짜 정밀도<select value={value.precision} onChange={e => onChange({ ...value, precision: e.target.value as Deadline["precision"], value: value.value === null ? null : "" })}><option value="date">날짜만</option><option value="datetime">날짜와 시간</option></select></label>
        {value.value !== null && <label className={s.field}>{value.precision === "date" ? "날짜" : "일시 (시간대 오프셋 포함)"}<input required type={value.precision === "date" ? "date" : "text"} placeholder="2026-10-01T15:00:00+09:00" value={value.value} onChange={e => set("value", e.target.value)}/>{value.precision === "datetime" && <span className={s.hint}>예: 2026-10-01T15:00:00+09:00. 원문의 정확한 시간과 오프셋을 입력하세요.</span>}</label>}
        <label className={s.field}>시간대<input required value={value.timezone} onChange={e => set("timezone", e.target.value)} placeholder="Asia/Seoul"/></label>
        <label className={s.field}>확정 수준<select value={value.certainty} onChange={e => set("certainty", e.target.value as Deadline["certainty"])}>{Object.entries(certaintyLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={s.field}>확인 책임자<select required value={value.responsibleUserId} onChange={e => set("responsibleUserId", e.target.value)}><option value="">담당자 선택</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className={s.field}>일정 출처<input value={value.source} onChange={e => set("source",e.target.value)} maxLength={1000}/></label>
        <label className={s.field}>출처 버전<input value={value.sourceVersion} onChange={e => set("sourceVersion",e.target.value)} maxLength={200}/></label>
        <label className={`${s.field} ${s.wide}`}>원문 날짜·미확인 내용<input value={value.raw} onChange={e => set("raw",e.target.value)} maxLength={2000}/></label>
    </div></fieldset>;
}
export function DeadlineView({ value, name }: { value: Deadline; name: (id: string) => string }) {
    return <dl className={s.meta}><dt>기한</dt><dd>{value.value ?? "기한 미정"} · {certaintyLabels[value.certainty]}</dd><dt>시간대·정밀도</dt><dd>{value.timezone} · {value.precision === "date" ? "날짜만" : "일시"}</dd><dt>확인 책임자</dt><dd>{name(value.responsibleUserId)}</dd>{value.source && <><dt>출처</dt><dd>{value.source} {value.sourceVersion}</dd></>}{value.raw && <><dt>원문·확인 내용</dt><dd>{value.raw}</dd></>}</dl>;
}
