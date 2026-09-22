import { ContextBar, StorageFailure } from '@/components/workspace';
import { readWorkspace, contextFromSearch, workspaceFailure, type Search } from '@/server/workspace';
import { importPage } from '@/features/evidence/server';
import { ImportScreen } from '@/features/imports/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: {
    searchParams: Search;
}) { const q = await searchParams, workspace = await readWorkspace(await contextFromSearch(Promise.resolve(q))).catch(workspaceFailure); if (!workspace)
    return <StorageFailure />; if (!workspace.selected)
    return <section className="panel"><h1>상품 Excel</h1><p>접근할 수 있는 컨텍스트가 없습니다.</p></section>; if (Array.isArray(q.batch))
    return <p role="alert">가져오기 결과 주소를 확인해 주세요.</p>; const data = await importPage(workspace.selected.id, q.batch).catch(workspaceFailure); return <><ContextBar workspace={workspace}/>{data ? <ImportScreen key={`${workspace.selected.id}:${data.userId}:${q.batch ?? ''}`} {...data}/> : <StorageFailure />}</>; }
