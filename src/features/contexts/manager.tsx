"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { catalog } from "@/domain/catalog";
import type { IdentityService } from "@/server/auth/service";
import { api } from "@/features/auth/client";
type Me = Awaited<ReturnType<IdentityService["me"]>>;
type Members = Awaited<ReturnType<IdentityService["members"]>>;
const states = { active: "활성", invited: "초대 대기", suspended: "중지" };
export function ContextManager({ initial }: {
    initial: Me;
}) {
    const [me, setMe] = useState(initial);
    const [selected, setSelected] = useState(initial.contexts.find(c => c.id === "ctx-jp-a-luna")?.id ?? initial.contexts[0]?.id ?? "");
    const [data, setData] = useState<Members | null>(null);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState("");
    const [type, setType] = useState("retail");
    const [reload, setReload] = useState(0);
    const grant = me.user.adminGrant;
    const manage = !!grant && (grant.scope === "all" || grant.contextIds.includes(selected));
    useEffect(() => { let ignore = false; if (selected && manage)
        api<Members>(`/api/contexts/${selected}/members`).then(x => { if (!ignore) {
            setData(x);
            setError("");
        } }).catch(e => { if (!ignore)
            setError(e.message); }); return () => { ignore = true; }; }, [selected, manage, reload]);
    async function mutate(action: () => Promise<unknown>, success: string) { setBusy(true); setError(""); setMessage(""); try {
        await action();
        setData(null);
        setReload(v => v + 1);
        setMessage(success);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); await mutate(async () => { const c = await api<{
        id: string;
    }>("/api/contexts", "POST", { type, countryId: f.get("countryId"), brandId: f.get("brandId"), ...(type === "retail" ? { retailerId: f.get("retailerId") } : { eventName: f.get("eventName") }) }); setMe(await api<Me>("/api/auth/me")); setSelected(c.id); form.reset(); }, "컨텍스트를 생성했습니다."); }
    async function invite(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); await mutate(async () => { const result = await api<{
        token: string;
    }>(`/api/contexts/${selected}/invitations`, "POST", Object.fromEntries(f)); setLink(`${window.location.origin}/invitations#${result.token}`); form.reset(); }, "초대 링크를 만들었습니다. 실제 이메일은 발송하지 않았습니다."); }
    return <><header className="page-heading"><p className="eyebrow">PEOPLE & CONTEXT</p><h1>컨텍스트·회원</h1><p>국가·리테일러·브랜드와 담당자를 연결합니다.</p></header>{error && <div role="alert" className="notice error">{error} <button className="button subtle" onClick={() => setReload(v => v + 1)}>다시 불러오기</button></div>}{message && <p role="status" className="notice">{message}</p>}
 <section className="panel"><label>관리할 컨텍스트<select value={selected} onChange={e => { setSelected(e.target.value); setData(null); setLink(""); }}><option value="" disabled>선택</option>{me.contexts.map(c => <option key={c.id} value={c.id}>{c.data.country} / {c.data.retailer} / {c.data.brand}{c.data.eventName ? ` · ${c.data.eventName}` : ""}</option>)}</select></label>{manage && selected && <button className="button subtle" onClick={() => { setData(null); setReload(v => v + 1); }}>회원 새로고침</button>}{selected ? <p><Link href={`/?context=${selected}`}>선택한 컨텍스트로 이동 ↗</Link></p> : <p>접근 가능한 컨텍스트가 없습니다. GSG 관리자에게 멤버십을 요청해 주세요.</p>}{!manage && <p>회원 관리는 권한이 있는 GSG 관리자만 이용할 수 있습니다.</p>}</section>
 {me.canCreateContext && <section className="panel section-block"><h2>컨텍스트 생성</h2><form className="identity-form form-grid" onSubmit={create}><label>유형<select value={type} onChange={e => setType(e.target.value)}><option value="retail">표준 리테일</option><option value="event">독립 행사</option></select></label><label>국가<select name="countryId" required><option value="">선택</option>{catalog.countries.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>브랜드<select name="brandId" required><option value="">선택</option>{catalog.brands.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{type === "retail" ? <label>리테일러<select name="retailerId" required><option value="">선택</option>{catalog.retailers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label> : <label>행사명<input name="eventName" required maxLength={200}/><small>리테일러 미지정 · 검토기관과 별개</small></label>}<button disabled={busy} className="button">컨텍스트 생성</button></form></section>}
 {manage && selected && <><section className="panel section-block"><h2>사용자 초대</h2><form className="identity-form form-grid" onSubmit={invite}><label>이름<input name="name" required maxLength={200}/></label><label>이메일<input name="email" type="email" required maxLength={254}/></label><label>역할<select name="role"><option value="brand">브랜드 사용자</option><option value="operator">GSG 운영자</option></select></label><label>담당 범위<input name="scope" maxLength={500}/></label><button className="button" disabled={busy}>초대 링크 생성</button></form>{link && <div className="invite-result"><label>새 초대 링크<input value={link} readOnly onFocus={e => e.target.select()}/></label><button className="button subtle" onClick={async () => { try {
            await navigator.clipboard.writeText(link);
            setMessage("초대 링크를 복사했습니다.");
        }
        catch {
            setError("링크 입력란을 선택해 직접 복사해 주세요.");
        } }}>링크 복사</button><p>48시간 동안 유효합니다. 실제 메일은 발송하지 않았습니다.</p></div>}</section>
 {!data ? <p role="status">회원 정보를 불러오는 중입니다.</p> : <><section className="panel section-block"><h2>컨텍스트 회원</h2>{!data.members.length && <p>아직 연결된 회원이 없습니다.</p>}<div className="member-list">{data.members.map(m => <article key={m.id} className="member-row"><div><strong>{m.user.name}</strong><p>{m.user.email} · {m.data.role === "brand" ? "브랜드" : "GSG 운영자"}</p><p>계정: {states[m.user.status ?? "invited"]} / 멤버십: {states[m.data.status]}</p><p>담당 범위: {m.data.scope || "미정"}</p></div><div className="member-actions">{m.data.status !== "invited" && <button className="button subtle" disabled={busy} onClick={() => mutate(() => api(`/api/contexts/${selected}/members/${m.id}`, "PATCH", { expectedRevision: m.revision, status: m.data.status === "active" ? "suspended" : "active" }), "멤버십 상태를 변경했습니다.")}>{m.data.status === "active" ? "멤버십 중지" : "멤버십 활성화"}</button>}{data.canManageAccounts && m.user.status !== "invited" && m.user.id !== me.user.id && <button className="button subtle" disabled={busy} onClick={() => mutate(() => api(`/api/users/${m.user.id}/status`, "PATCH", { expectedRevision: m.user.revision, status: m.user.status === "active" ? "suspended" : "active" }), "계정 상태를 변경했습니다. 기존 세션은 재사용할 수 없습니다.")}>{m.user.status === "active" ? "계정 전체 중지" : "계정 활성화"}</button>}<form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate(() => api(`/api/contexts/${selected}/members/${m.id}`, "PATCH", { expectedRevision: m.revision, status: m.data.status, scope: f.get("scope"), internalPriceAccess: m.data.role === "operator" ? f.get("price") === "on" : false }), "담당 범위를 저장했습니다."); }}><label>담당 범위 수정<input name="scope" defaultValue={m.data.scope} maxLength={500} required/></label>{m.data.role === "operator" && <label><input type="checkbox" name="price" defaultChecked={m.data.internalPriceAccess}/> 내부 가격 접근</label>}<button className="button subtle" disabled={busy || m.data.status === "invited"}>범위 저장</button></form></div></article>)}</div></section>
 <section className="panel section-block"><h2>초대 상태·재발급</h2>{data.invitations.length === 0 ? <p>생성된 초대가 없습니다.</p> : data.invitations.map(i => <div key={i.id} className="member-row"><p>{data.members.find(m => m.id === i.membershipId)?.user.email} · {i.consumedAt ? "수락 완료" : i.revokedAt ? "철회됨" : new Date(i.expiresAt) < new Date() ? "만료됨" : "초대 대기"} · {i.expiresAt}</p>{!i.consumedAt && !i.revokedAt && <button className="button subtle" disabled={busy} onClick={() => mutate(async () => { const result = await api<{
                token: string;
            }>(`/api/invitations/${i.id}/reissue`, "POST", { expectedRevision: i.revision }); setLink(`${window.location.origin}/invitations#${result.token}`); }, "새 링크를 만들고 이전 링크를 철회했습니다.")}>초대 재발급</button>}</div>)}</section>
 <section className="panel section-block"><h2>진행 업무 재배정</h2>{data.tasks.filter(t => t.data.status !== "completed").map(t => <Reassignment key={`${t.id}-${t.revision}`} task={t} members={data.members} busy={busy} onSubmit={(body) => mutate(() => api(`/api/contexts/${selected}/reassignments`, "POST", body), "현재 담당자를 변경하고 작성자 이력을 보존했습니다.")}/>)}{data.tasks.length === 0 && <p>연결된 업무가 없습니다.</p>}</section>
 <section className="panel section-block"><h2>변경 이력</h2>{data.history.length === 0 ? <p>아직 변경 이력이 없습니다.</p> : <ul>{data.history.map(h => <li key={h.id}>{new Date(h.data.at).toLocaleString("ko-KR")} · {actionLabels[h.data.action] ?? "기록 변경"} · 기록자 {data.members.find(m => m.user.id === h.data.actorId)?.user.name ?? (me.user.id === h.data.actorId ? me.user.name : "GSG 관리자")}<p>{describeChange(h.data.before, data.members)} → {describeChange(h.data.after, data.members)}</p></li>)}</ul>}</section></>}
 </>}
 </>;
}
function Reassignment({ task: t, members, busy, onSubmit }: {
    task: Members["tasks"][number];
    members: Members["members"];
    busy: boolean;
    onSubmit: (body: unknown) => Promise<void>;
}) {
    const [role, setRole] = useState("brand");
    return <form className="member-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void onSubmit({ taskId: t.id, toUserId: f.get("toUserId"), expectedRevision: t.revision, assignmentRole: role }); }}><div><strong>{t.data.title}</strong><p>현재 브랜드 담당: {members.find(m => m.user.id === t.data.assigneeId)?.user.name} · GSG 책임자: {members.find(m => m.user.id === t.data.ownerId)?.user.name}</p><p>최초 작성자: {members.find(m => m.user.id === t.data.authorId)?.user.name ?? "기존 작성자"}</p>{t.data.assignmentNeedsAttention && <span className="badge">재배정 필요</span>}</div><label>배정 역할<select value={role} onChange={e => setRole(e.target.value)}><option value="brand">브랜드 담당자</option><option value="gsg">GSG 책임자</option></select></label><label>새 담당자<select name="toUserId" required defaultValue="" key={role}><option value="" disabled>활성 담당자 선택</option>{members.filter(m => m.user.role === role && m.data.status === "active" && m.user.status === "active").map(m => <option key={m.id} value={m.user.id}>{m.user.name}</option>)}</select></label><button className="button" disabled={busy}>재배정</button></form>;
}

const actionLabels: Record<string, string> = {
    "context.created": "컨텍스트 생성", "invitation.created": "초대 생성", "invitation.reissued": "초대 재발급",
    "invitation.accepted": "초대 수락", "membership.changed": "멤버십 변경", "user.status": "계정 상태 변경", "task.reassigned": "업무 재배정"
};
function describeChange(value: Record<string, unknown>, members: Members["members"]) {
    const fields: Record<string, string> = { assigneeId: "브랜드 담당", ownerId: "GSG 책임자", authorId: "최초 작성자", status: "상태", scope: "담당 범위", internalPriceAccess: "내부 가격", country: "국가", retailer: "리테일러", brand: "브랜드", eventName: "행사명" };
    const parts = Object.entries(value).filter(([key]) => fields[key]).map(([key, entry]) => {
        const display = key.endsWith("Id") ? members.find(m => m.user.id === entry)?.user.name ?? "기존 담당자" : key === "status" ? states[entry as keyof typeof states] ?? entry : typeof entry === "boolean" ? entry ? "허용" : "차단" : entry;
        return `${fields[key]}: ${display || "미정"}`;
    });
    return parts.length ? parts.join(" · ") : "초대 상태 기록";
}
