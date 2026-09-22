import type { Metadata } from "next";
import { StorageFailure } from "@/components/workspace";
import { workspaceFailure,type Search } from "@/server/workspace";
import { listPage } from "@/features/products/server";
import { ProductListScreen } from "@/features/products/list";
export const metadata:Metadata={title:"상품정보"};export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Search}){const result=await listPage(searchParams).catch(workspaceFailure);return result?<ProductListScreen {...result}/>:<StorageFailure/>;}
