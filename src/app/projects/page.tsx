import type { Metadata } from "next";
import { ContextBar, StorageFailure, EmptyState } from "@/components/workspace";
import { workspaceFailure, type Search } from "@/server/workspace";
import { catalogPage } from "@/features/tasks/server";
import { Projects } from "@/features/projects/manager";
export const metadata: Metadata = { title: "신규 입점 프로젝트" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: {
    searchParams: Search;
}) { const d = await catalogPage(searchParams).catch(workspaceFailure); if (!d)
    return <StorageFailure />; return <><ContextBar workspace={d.workspace}/>{d.catalog && d.workspace.selected ? <Projects key={d.workspace.selected.id} catalog={d.catalog} contextId={d.workspace.selected.id}/> : <EmptyState title="연결된 컨텍스트가 없습니다" detail="GSG 담당자에게 문의해 주세요."/>}</>; }
