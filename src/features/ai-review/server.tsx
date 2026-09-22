import 'server-only';
import { identity, currentToken } from '@/server/auth/runtime';
import { AiReviewService } from '@/server/ai-review/service';
import { AuthError } from '@/server/auth/errors';
import { readWorkspace, workspaceFailure, type Search } from '@/server/workspace';
import { ContextBar, EmptyState, StorageFailure } from '@/components/workspace';
import { ReviewSurface } from './surface';
import type { Selection, View } from './model';
export async function ReviewPage({ kind, id, searchParams }: {
    kind: View['kind'];
    id?: string;
    searchParams: Search;
}) {
    const q = await searchParams, keys = ['context', ...(kind === 'input' ? ['versionId'] : kind === 'corpus' ? ['releaseId'] : [])];
    if (Object.keys(q).some(k => !keys.includes(k)) || keys.some(k => Array.isArray(q[k]) || q[k] === ''))
        return <p role="alert">컨텍스트와 정확한 버전을 하나씩 지정해 주세요.</p>;
    const context = typeof q.context === 'string' ? q.context : undefined, workspace = await readWorkspace(context).catch(workspaceFailure);
    if (!workspace)
        return <StorageFailure />;
    if (!workspace.selected)
        return <EmptyState title="선택할 컨텍스트가 없습니다" detail="허용된 컨텍스트를 확인해 주세요."/>;
    const selection: Selection = { kind, id, contextId: workspace.selected.id, versionId: typeof q.versionId === 'string' ? q.versionId : undefined, releaseId: typeof q.releaseId === 'string' ? q.releaseId : undefined };
    const initial = await (async () => { const auth = await identity(), token = await currentToken(), me = await auth.me(token), service = new AiReviewService(auth); const data = kind === 'list' ? await service.list(token, selection.contextId) : kind === 'input' ? await service.workspace(token, id!, selection.versionId) : kind === 'run' ? await service.detail(token, id!) : await service.corpus(token, selection.contextId, selection.releaseId); if ('contextId' in data && data.contextId !== selection.contextId)
        throw new AuthError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.'); return { actorId: me.user.id, view: { kind, data } as View }; })().catch(workspaceFailure);
    if (!initial)
        return <StorageFailure />;
    return <><ContextBar workspace={workspace}/><ReviewSurface key={JSON.stringify([initial.actorId, selection])} initial={initial.view} actorId={initial.actorId} selection={selection}/></>;
}
