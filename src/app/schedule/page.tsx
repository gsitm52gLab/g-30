import { ContextBar, StorageFailure } from '@/components/workspace';
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from '@/server/workspace';
import { scheduleData } from '@/features/scheduling/server';
import { ScheduleScreen } from '@/features/scheduling/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: {
    searchParams: Search;
}) {
    const q = await searchParams, w = await (await readWorkspace(await contextFromSearch(Promise.resolve(q)))).catch(workspaceFailure);
    if (!w)
        return <StorageFailure />;
    if (!w.selected)
        return <section className="panel"><h1>일정</h1><p>접근 가능한 컨텍스트가 없습니다.</p></section>;
    const data = await (await scheduleData(w.selected.id)).catch(workspaceFailure);
    return <><ContextBar workspace={w}/>{data ? <ScheduleScreen key={`${data.actorId}:${w.selected.id}`} {...data} initialTask={typeof q.task === 'string' ? q.task : ''}/> : <StorageFailure />}</>;
}
