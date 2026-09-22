import type { Metadata } from "next";
import { ContextBar, StorageFailure, EmptyState } from "@/components/workspace";
import { workspaceFailure, type Search } from "@/server/workspace";
import { catalogPage } from "@/features/tasks/server";
import { TaskCatalogView } from "@/features/tasks/list";
export const metadata: Metadata = { title: "업무" };
export const dynamic = "force-dynamic";
export default async function Tasks({ searchParams }: {
    searchParams: Search;
}) { const data = await (await catalogPage(searchParams)).catch(workspaceFailure); if (!data)
    return <StorageFailure />; return <><ContextBar workspace={data.workspace}/>{data.catalog && data.workspace.selected ? <TaskCatalogView key={data.workspace.selected.id} catalog={data.catalog} contextId={data.workspace.selected.id}/> : <EmptyState title="연결된 컨텍스트가 없습니다" detail="GSG 담당자에게 컨텍스트 연결을 요청해 주세요."/>}</>; }
