"use client";
import { useRef, useState } from "react";
import type { TaskDetail } from "@/server/tasks/service";
import { request } from "./client";
import { FileLinks } from "./request-view";
import s from "./ui.module.css";
export function ReferenceEditor({ taskId, files, selected, onSelect, onUploaded }: {taskId:string;files:TaskDetail["files"];selected:string[];onSelect:(ids:string[])=>void;onUploaded:(files:TaskDetail["files"])=>void}) {
    const [visibility,setVisibility]=useState("public"),[error,setError]=useState(""),[busy,setBusy]=useState(false); const input=useRef<HTMLInputElement>(null);
    async function upload() {
        const items=Array.from(input.current?.files??[]);setError("");
        if (!items.length) {setError("업로드할 파일을 선택해 주세요.");return;}
        if (items.length>10||items.some(f=>f.size>25*1024*1024)) {setError("파일은 한 번에 10개, 각 25MiB까지 선택할 수 있습니다.");return;}
        const body=new FormData();for(const f of items)body.append("files",f);body.append("visibility",visibility);setBusy(true);
        try {const result=await request<{files:TaskDetail["files"]}>(`/api/files?taskId=${encodeURIComponent(taskId)}`,body);onUploaded(result.files);onSelect([...new Set([...selected,...result.files.map(f=>f.id)])]);if(input.current)input.current.value="";}
        catch(e){setError(e instanceof Error?e.message:"업로드하지 못했습니다. 선택을 유지하고 재시도해 주세요.");}finally{setBusy(false);}
    }
    return <section className={s.panel}><h2>참고파일</h2><p className={s.hint}>파일을 올린 뒤 참고자료로 선택하고 초안을 저장하세요. 공개 요청에 사용된 이전 파일 버전은 유지됩니다.</p><div className={s.grid}><label className={s.field}>참고파일 선택<input className={s.filesInput} type="file" multiple ref={input} accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.ai,.zip,.mp4,.mov"/></label><label className={s.field}>파일 공개 범위<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="public">브랜드 공개</option><option value="internal">GSG 내부</option></select></label></div><div className={s.actions}><button type="button" className="button subtle" disabled={busy} onClick={upload}>{busy?"업로드 중…":"선택 파일 업로드"}</button><span className={s.small}>25MiB/개 · 한 번에 10개</span></div>{error&&<p role="alert" className={s.error}>{error}</p>}<div>{files.map(f=><div key={f.id}><label className={s.check}><input type="checkbox" checked={selected.includes(f.id)} onChange={e=>onSelect(e.target.checked?[...selected,f.id]:selected.filter(id=>id!==f.id))}/>{f.name}을 참고자료로 연결</label><FileLinks file={f} taskId={taskId}/></div>)}</div></section>;
}
