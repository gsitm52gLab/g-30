import Link from "next/link";
import type { Workspace } from "@/server/workspace";
import type { StoredRecord } from "@/domain/records";
export function ContextBar({ workspace }: {
    workspace: Workspace;
}) {
    return <section className="context-bar" aria-label="현재 컨텍스트"><div><p className="eyebrow">WORKSPACE</p><p className="context-name">{workspace.selected ? `${workspace.selected.data.country} / ${workspace.selected.data.retailer} / ${workspace.selected.data.brand}${workspace.selected.data.eventName ? ` · ${workspace.selected.data.eventName}` : ""}` : "컨텍스트 없음"}</p></div><form action="" method="get"><label className="sr-only" htmlFor="context">컨텍스트 선택</label><select id="context" name="context" defaultValue={workspace.selected?.id}><option value="" disabled>컨텍스트 선택</option>{workspace.contexts.map(c => <option key={c.id} value={c.id}>{c.data.country} · {c.data.retailer} · {c.data.brand}{c.data.eventName ? ` · ${c.data.eventName}` : ""}</option>)}</select><button className="button subtle" type="submit">전환</button></form><span className="storage-label">{workspace.mode === "sqlite" ? "SQLite · 영속 저장" : "Mock · 재시작 시 초기화"}</span></section>;
}
export function EmptyState({ title, detail }: {
    title: string;
    detail: string;
}) { return <div className="empty-state"><span aria-hidden="true" className="empty-mark">—</span><h2>{title}</h2><p>{detail}</p></div>; }
export function StorageFailure() { return <section role="alert" className="notice error"><h1>자료를 불러오지 못했습니다</h1><p>저장소 연결 또는 환경 설정을 확인한 후 다시 시도해 주세요. DB 자료를 불러오지 못했을 때 예시 자료로 바꾸지 않습니다.</p><Link className="button" href="/">다시 시도</Link></section>; }
export const categoryLabels = { onboarding: "신규 입점", spot: "스팟 업무" };
export const taskLabels = { draft: "내부 초안", requested: "요청됨", in_progress: "진행 중", partial: "부분 제출", submitted: "제출됨", completed: "GSG 업무 완료", on_hold: "보류", cancelled: "취소" };
export const productLabels = { draft: "등록 준비", active: "판매 중", archived: "보관" };
export function TaskList({ tasks, users }: Pick<Workspace, "tasks" | "users">) {
    if (!tasks.length)
        return <EmptyState title="아직 등록된 업무가 없습니다" detail="현재 컨텍스트에 연결된 업무가 없습니다."/>;
    return <div className="task-list">{tasks.map(task => <article className="task-row" key={task.id}><div className="task-main"><div className="row-tags"><span className="small-label">{categoryLabels[task.data.category]}</span><span className={`badge ${task.data.status}`}>{taskLabels[task.data.status]}</span></div><Link className="item-title" href={`/tasks/${task.id}?context=${task.contextId}`}>{task.data.title}<span aria-hidden="true"> ↗</span></Link><p>{task.data.nextAction}</p></div><div className="task-meta"><span>{users.find(u => u.id === task.data.assigneeId)?.data.name ?? "담당자 확인 필요"}</span><strong>{task.data.deadline ?? "기한 미정"}</strong></div></article>)}</div>;
}
export function ProductCards({ products }: {
    products: StoredRecord<"product">[];
}) {
    if (!products.length)
        return <EmptyState title="아직 등록된 상품이 없습니다" detail="현재 컨텍스트에 연결된 상품이 없습니다."/>;
    return <div className="product-grid">{products.map((product, index) => <article className="product-card" key={product.id}><div className={`product-art tone-${index % 3}`}><span className="art-caption">이미지·자료는 상품 상세에서 확인</span></div><div className="product-body"><span className="small-label">{product.data.brand} · {product.data.category}</span><Link href={`/products/${product.id}?context=${product.contextId}`} className="item-title">{product.data.name} ↗</Link><p>{product.data.code} · {product.data.size}</p><div className="product-bottom"><span className="badge">{productLabels[product.data.status]}</span><span>자료 집계 연결 예정</span></div></div></article>)}</div>;
}
