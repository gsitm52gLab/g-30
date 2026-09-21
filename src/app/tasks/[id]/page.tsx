import Link from "next/link";
import { notFound } from "next/navigation";
import { ContextBar, StorageFailure, categoryLabels, taskLabels } from "@/components/workspace";
import { contextFromSearch, readWorkspace, type Search } from "@/server/workspace";
export const dynamic = "force-dynamic";
export default async function TaskDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const { id } = await params;
  const workspace = await readWorkspace(await contextFromSearch(searchParams)).catch(() => null);
  if (!workspace) return <StorageFailure />;
  const task = workspace.tasks.find(t => t.id === id); if (!task) notFound();
  return <><ContextBar workspace={workspace} /><Link className="back-link" href={`/tasks?context=${task.contextId}`}>← 업무 목록</Link><header className="page-heading"><p className="eyebrow">{categoryLabels[task.data.category]}</p><h1>{task.data.title}</h1><span className="badge">{taskLabels[task.data.status]}</span></header><div className="detail-grid"><section className="panel"><h2>요청 내용</h2><p>{task.data.description}</p><h3>다음 행동</h3><p>{task.data.nextAction}</p>{task.data.notes.length > 0 && <><h3>확인할 내용</h3><ul>{task.data.notes.map(n => <li key={n}>{n}</li>)}</ul></>}<h3>관련 상품</h3>{task.data.productIds.map(productId => <p key={productId}><Link href={`/products/${productId}?context=${task.contextId}`}>{workspace.products.find(p => p.id === productId)?.data.name ?? "상품 확인"} ↗</Link></p>)}</section><aside className="panel"><h2>업무 정보</h2><dl><dt>브랜드 담당</dt><dd>{workspace.users.find(u => u.id === task.data.assigneeId)?.data.name}</dd><dt>GSG 담당</dt><dd>{workspace.users.find(u => u.id === task.data.ownerId)?.data.name}</dd><dt>기한</dt><dd>{task.data.deadline ?? "기한 미정"}</dd><dt>저장 버전</dt><dd>v{task.revision}</dd></dl></aside></div></>;
}
