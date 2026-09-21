import {ContextBar,StorageFailure} from '@/components/workspace';
import {readWorkspace,contextFromSearch,workspaceFailure,type Search} from '@/server/workspace';
import {materials} from '@/features/evidence/server';
import {MaterialScreen} from '@/features/evidence/screen';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Search}){const q=await searchParams,workspace=await readWorkspace(await contextFromSearch(Promise.resolve(q))).catch(workspaceFailure);if(!workspace)return <StorageFailure/>;if(!workspace.selected)return <section className="panel"><h1>자료함·제출표</h1><p>접근할 수 있는 컨텍스트가 없습니다.</p></section>;const data=await materials(workspace.selected.id,q.history==='1').catch(workspaceFailure);return <><ContextBar workspace={workspace}/>{data?<MaterialScreen key={`${workspace.selected.id}:${q.history}`} {...data} productId={typeof q.productId==='string'?q.productId:''} taskId={typeof q.taskId==='string'?q.taskId:''} status={typeof q.status==='string'?q.status:''} count={typeof q.count==='string'?q.count:''}/>:<StorageFailure/>}</>;}
