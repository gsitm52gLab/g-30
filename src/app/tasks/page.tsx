import type { Metadata } from "next";
import { ContextBar, TaskList, StorageFailure } from "@/components/workspace";
import { contextFromSearch, readWorkspace, type Search } from "@/server/workspace";
export const metadata: Metadata = { title: "업무" };
export const dynamic = "force-dynamic";
export default async function Tasks({ searchParams }: { searchParams: Search }) {
  const workspace = await readWorkspace(await contextFromSearch(searchParams)).catch(() => null);
  if (!workspace) return <StorageFailure />;
  return <><ContextBar workspace={workspace} /><header className="page-heading"><p className="eyebrow">WORK, CONNECTED</p><h1>업무</h1><p>신규 입점과 스팟 업무의 담당자, 기한, 다음 행동을 확인하세요.</p></header><div className="notice">합성 업무의 읽기 전용 미리보기입니다. 생성·배정·제출은 후속 단계에서 연결됩니다.</div><TaskList tasks={workspace.tasks} users={workspace.users} /></>;
}
