import type { Metadata } from "next";
import { ContextBar, ProductCards, StorageFailure } from "@/components/workspace";
import { contextFromSearch, readWorkspace, workspaceFailure, type Search } from "@/server/workspace";
export const metadata: Metadata = { title: "상품정보" };
export const dynamic = "force-dynamic";
export default async function Products({ searchParams }: {
    searchParams: Search;
}) {
    const workspace = await readWorkspace(await contextFromSearch(searchParams)).catch(workspaceFailure);
    if (!workspace)
        return <StorageFailure />;
    return <><ContextBar workspace={workspace}/><header className="page-heading"><p className="eyebrow">PRODUCT LIBRARY</p><h1>상품정보</h1><p>컨텍스트별 상품과 필요한 자료를 함께 확인하세요.</p></header><div className="notice">합성 상품의 읽기 전용 미리보기입니다. 등록·수정·가격 권한·Excel은 후속 단계에서 연결됩니다.</div><ProductCards products={workspace.products}/></>;
}
