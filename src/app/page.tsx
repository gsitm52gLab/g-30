import Link from "next/link";
import {NoticeListScreen} from "@/features/notices/list";
import { BRAND } from "@/domain/brand";
import { ContextBar, EmptyState, StorageFailure, TaskList } from "@/components/workspace";
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from "@/server/workspace";
export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: {
    searchParams: Search;
}) {
    const workspace = await readWorkspace(await contextFromSearch(searchParams)).catch(workspaceFailure);
    if (!workspace)
        return <StorageFailure />;
    return <><ContextBar workspace={workspace}/><section className="hero"><div className="hero-copy"><p className="eyebrow light">YOUR NEXT CHAPTER, CONNECTED</p><h1>해외 헬스케어 진출의<br /><em>모든 일</em></h1><p>{BRAND.definition}</p><Link className="button hero-button" href={`/tasks?context=${workspace.selected?.id ?? ""}`}>업무 살펴보기 <span aria-hidden="true">↗</span></Link></div><div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="orbit-dot"/><span className="hero-monogram">H</span><p>GLOBAL POSSIBILITIES.<br />ONE CONNECTED FLOW.</p></div></section><section className="intro-line"><h2>{BRAND.campaign}</h2><p>업무와 상품, 담당자와 다음 행동을 하나의 흐름에서 확인하세요.</p></section><section className="metric-grid" aria-label="현재 컨텍스트 요약"><div className="metric"><span>연결된 업무</span><strong>{workspace.tasks.length.toString().padStart(2, "0")}</strong><small>현재 컨텍스트 기준</small></div><div className="metric"><span>등록 상품</span><strong>{workspace.products.length.toString().padStart(2, "0")}</strong><small>상품 자료와 업무 연결</small></div><div className="metric"><span>기한 확인 필요</span><strong>{workspace.tasks.filter(t => !t.data.deadline).length.toString().padStart(2, "0")}</strong><small>기한 미정 업무</small></div></section><section className="section-block"><div className="section-heading"><div><p className="eyebrow">NEXT ACTION</p><h2>지금 확인할 업무</h2></div><Link href={`/tasks?context=${workspace.selected?.id ?? ""}`}>전체 업무 보기 ↗</Link></div>{workspace.selected ? <TaskList tasks={workspace.tasks} users={workspace.users}/> : <EmptyState title="선택할 컨텍스트가 없습니다" detail="GSG 관리자에게 컨텍스트 멤버십을 요청해 주세요."/>}</section>{workspace.selected&&<section className="section-block"><NoticeListScreen key={workspace.selected.id} contextId={workspace.selected.id} home/></section>}</>;
}
