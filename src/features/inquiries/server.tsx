import 'server-only';
import type { ReactNode } from 'react';
import { ContextBar, EmptyState, StorageFailure } from '@/components/workspace';
import { readWorkspace, contextFromSearch, workspaceFailure, type Search } from '@/server/workspace';
export async function InquiryPage({ searchParams, children }: {
    searchParams: Search;
    children: (contextId: string) => ReactNode;
}) {
    const raw = await searchParams;
    if (Array.isArray(raw.context))
        return <p role="alert">컨텍스트를 하나만 지정해 주세요.</p>;
    const workspace = await (await readWorkspace(await contextFromSearch(searchParams))).catch(workspaceFailure);
    if (!workspace)
        return <StorageFailure />;
    return <><ContextBar workspace={workspace}/>{workspace.selected ? children(workspace.selected.id) : <EmptyState title="선택할 컨텍스트가 없습니다" detail="현재 컨텍스트 멤버십을 확인해 주세요."/>}</>;
}
