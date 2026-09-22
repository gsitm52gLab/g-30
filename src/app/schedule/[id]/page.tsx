import { ContextBar, StorageFailure } from '@/components/workspace';
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from '@/server/workspace';
import { scheduleData } from '@/features/scheduling/server';
import { ScheduleScreen } from '@/features/scheduling/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Search;
}) {
    const { id } = await params, w = await (await readWorkspace(await contextFromSearch(searchParams))).catch(workspaceFailure);
    if (!w?.selected)
        return <StorageFailure />;
    const data = await (await scheduleData(w.selected.id, id)).catch(workspaceFailure);
    return <><ContextBar workspace={w}/>{data ? <ScheduleScreen key={`${data.actorId}:${w.selected.id}:${id}`} {...data}/> : <StorageFailure />}</>;
}
