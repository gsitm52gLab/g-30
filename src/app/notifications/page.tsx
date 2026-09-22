import { ContextBar, StorageFailure } from '@/components/workspace';
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from '@/server/workspace';
import { NotificationScreen } from '@/features/notifications/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: {
    searchParams: Search;
}) {
    const w = await (await readWorkspace(await contextFromSearch(searchParams))).catch(workspaceFailure);
    if (!w)
        return <StorageFailure />;
    return <><ContextBar workspace={w}/><h1>알림</h1>{w.selected ? <NotificationScreen key={w.selected.id} contextId={w.selected.id}/> : <p>접근 가능한 컨텍스트가 없습니다.</p>}</>;
}
