import type { Metadata } from "next";
import { StorageFailure } from "@/components/workspace";
import { workspaceFailure,type Search } from "@/server/workspace";
import { listPage } from "@/features/products/server";
import { CreateProduct } from "@/features/products/create";
export const metadata:Metadata={title:"상품 등록"};export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Search}){const result=await listPage(Promise.resolve({})).catch(workspaceFailure);if(!result)return <StorageFailure/>;const query=await searchParams;const context=result.data.contexts.find(c=>c.id===query.context)??result.data.contexts[0];return context?<CreateProduct contexts={result.data.contexts} initialContext={context.id}/>:<section><h1>등록 가능한 컨텍스트가 없습니다</h1></section>;}
