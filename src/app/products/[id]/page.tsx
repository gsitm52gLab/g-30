import { notFound } from "next/navigation";
import { StorageFailure } from "@/components/workspace";
import { workspaceFailure, type Search } from "@/server/workspace";
import { detailPage } from "@/features/products/server";
import { ProductDetailScreen } from "@/features/products/detail";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Search;
}) { const { id } = await params, query = await searchParams; if (typeof query.context !== 'string' || !query.context)
    notFound(); const data = await detailPage(id, query.context).catch(workspaceFailure); return data ? <ProductDetailScreen key={`${id}:${query.context}`} initial={data}/> : <StorageFailure />; }
