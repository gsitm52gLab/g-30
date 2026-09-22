import { notFound } from 'next/navigation';
import { ContextBar, StorageFailure } from '@/components/workspace';
import { readWorkspace, workspaceFailure, type Search } from '@/server/workspace';
import { evidenceDetail } from '@/features/evidence/server';
import { EvidenceDetailScreen } from '@/features/evidence/detail';
export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Search;
}) { const { id } = await params, q = await searchParams; if (typeof q.context !== 'string' || !q.context)
    notFound(); const workspace = await (await readWorkspace(q.context)).catch(workspaceFailure); if (!workspace)
    return <StorageFailure />; const data = await (await evidenceDetail(id, q.context)).catch(workspaceFailure); return <><ContextBar workspace={workspace}/>{data ? <EvidenceDetailScreen key={`${id}:${q.context}`} {...data}/> : <StorageFailure />}</>; }
