import { ContextBar, StorageFailure } from "@/components/workspace";
import { workspaceFailure, readWorkspace, type Search } from "@/server/workspace";
import { catalogPage } from "@/features/tasks/server";
import { Project } from "@/features/projects/manager";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Search;
}) { const data = await (async () => { const d = await catalogPage(searchParams); const project = await d.service.project(d.token, (await params).id); const catalog = await d.service.catalog(d.token, project.contextId!); return { ...d, workspace: await readWorkspace(project.contextId!), project, catalog }; })().catch(workspaceFailure); if (!data)
    return <StorageFailure />; return <><ContextBar workspace={data.workspace}/><Project key={data.project.id} initial={data.project} catalog={data.catalog}/></>; }
