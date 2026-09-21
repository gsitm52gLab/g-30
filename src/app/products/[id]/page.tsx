import Link from "next/link";
import { notFound } from "next/navigation";
import { ContextBar, StorageFailure, productLabels } from "@/components/workspace";
import { contextFromSearch, readWorkspace, type Search } from "@/server/workspace";
export const dynamic = "force-dynamic";
export default async function ProductDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const { id } = await params;
  const workspace = await readWorkspace(await contextFromSearch(searchParams)).catch(() => null);
  if (!workspace) return <StorageFailure />;
  const product = workspace.products.find(p => p.id === id); if (!product) notFound();
  return <><ContextBar workspace={workspace} /><Link className="back-link" href={`/products?context=${product.contextId}`}>← 상품 목록</Link><header className="page-heading"><p className="eyebrow">{product.data.brand}</p><h1>{product.data.name}</h1><span className="badge">{productLabels[product.data.status]}</span></header><div className="detail-grid"><section className="panel"><h2>기본정보</h2><dl><dt>제품 코드</dt><dd>{product.data.code}</dd><dt>용량</dt><dd>{product.data.size}</dd><dt>카테고리</dt><dd>{product.data.category}</dd><dt>자료 확인</dt><dd>{product.data.missingMaterials}건</dd></dl></section><section className="panel"><h2>관련 업무</h2>{workspace.tasks.filter(t => t.data.productIds.includes(id)).map(t => <p key={t.id}><Link href={`/tasks/${t.id}?context=${product.contextId}`}>{t.data.title} ↗</Link></p>)}{!workspace.tasks.some(t => t.data.productIds.includes(id)) && <p>연결된 업무가 없습니다.</p>}</section></div></>;
}
