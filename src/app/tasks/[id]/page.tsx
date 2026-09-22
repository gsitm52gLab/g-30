import Link from "next/link";
import { InquiryListScreen } from "@/features/inquiries/list";
import { parseSubmissionReference } from "@/features/submissions/reference";
import { identity, currentToken } from "@/server/auth/runtime";
import { TaskService } from "@/server/tasks/service";
import { TaskDetailView } from "@/features/tasks/detail";
import { notFound } from "next/navigation";
import { ContextBar, StorageFailure, categoryLabels, taskLabels } from "@/components/workspace";
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from "@/server/workspace";
export const dynamic = "force-dynamic";
export default async function TaskDetail({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Search;
}) {
    const { id } = await params;
    const search = await searchParams, query = new URLSearchParams();
    for (const [key, value] of Object.entries(search))
        for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value])
            query.append(key, v);
    const reference = parseSubmissionReference(id, query);
    const unavailableReference = <section className="panel" role="alert"><h1>지정한 자료를 열 수 없습니다</h1><p>주소와 현재 접근 권한을 확인해 주세요. 최신 제출로 대신 표시하지 않습니다.</p></section>;
    if (reference.kind === 'invalid')
        return unavailableReference;
    const workspace = await (await readWorkspace(await contextFromSearch(Promise.resolve(search)))).catch(reference.kind === 'none' ? workspaceFailure : () => null);
    if (!workspace)
        return reference.kind !== 'none' ? unavailableReference : <StorageFailure />;
    const task = workspace.tasks.find(t => t.id === id);
    if (!task) {
        if (reference.kind !== 'none')
            return unavailableReference;
        notFound();
    }
    if (task.data.schemaVersion === 2) {
        const result = await (await (async () => { const service = new TaskService(await identity()); const token = await currentToken(); return { detail: await service.detail(token, id, task.contextId!), catalog: await service.catalog(token, task.contextId!) }; })()).catch(workspaceFailure);
        if (!result)
            return reference.kind !== 'none' ? unavailableReference : <StorageFailure />;
        return <><ContextBar workspace={workspace}/><TaskDetailView key={id} initial={result.detail} catalog={result.catalog}/></>;
    }
    if (reference.kind !== 'none')
        return unavailableReference;
    return <><ContextBar workspace={workspace}/><Link className="back-link" href={`/tasks?context=${task.contextId}`}>← 업무 목록</Link><header className="page-heading"><p className="eyebrow">{categoryLabels[task.data.category]}</p><h1>{task.data.title}</h1><Link className="back-link" href={`/tasks/${task.id}/corrections?context=${task.contextId}`}>수정 취합·검토 기록 ↗</Link><Link className="back-link" href={`/tasks/${task.id}/completion?context=${task.contextId}`}>외부 진행·업무 완료 ↗</Link><span className="badge">{taskLabels[task.data.status]}</span></header><p><Link className="button subtle" href={`/ai-input/new?context=${task.contextId}&task=${id}`}>이 업무의 AI 입력 작성 ↗</Link></p><div className="detail-grid"><section className="panel"><Link className="button subtle" href={`/tasks/${id}/campaigns?context=${task.contextId}`}>PR·행사 참여와 실물 ↗</Link><h2>요청 내용</h2><p>{task.data.description}</p><h3>다음 행동</h3><p>{task.data.nextAction}</p>{task.data.notes.length > 0 && <><h3>확인할 내용</h3><ul>{task.data.notes.map(n => <li key={n}>{n}</li>)}</ul></>}<h3>관련 상품</h3>{task.data.productIds.map(productId => <p key={productId}><Link href={`/products/${productId}?context=${task.contextId}`}>{workspace.products.find(p => p.id === productId)?.data.name ?? "상품 확인"} ↗</Link></p>)}</section><aside className="panel"><h2>업무 정보</h2><dl><dt>브랜드 담당</dt><dd>{workspace.users.find(u => u.id === task.data.assigneeId)?.data.name}</dd><dt>GSG 담당</dt><dd>{workspace.users.find(u => u.id === task.data.ownerId)?.data.name}</dd><dt>기한</dt><dd>{task.data.deadline ?? "기한 미정"}</dd><dt>저장 버전</dt><dd>v{task.revision}</dd></dl></aside></div><InquiryListScreen key={task.contextId! + id} contextId={task.contextId!} taskId={id}/></>;
}
