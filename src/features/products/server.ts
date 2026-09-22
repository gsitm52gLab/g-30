import "server-only";
import { identity, currentToken } from "@/server/auth/runtime";
import { ProductService, type ProductListQuery } from "@/server/products/service";
import type { Search } from "@/server/workspace";
export async function listPage(search: Search) { const values = await search, query: ProductListQuery = {}; for (const key of ['context', 'q', 'country', 'retailer', 'brand', 'sku', 'category', 'status', 'page', 'pageSize'] as const)
    if (typeof values[key] === 'string' && values[key])
        query[key] = values[key] as string; const auth = await identity(); return { data: await new ProductService(auth).list(await currentToken(), query), query }; }
export async function detailPage(id: string, contextId: string) { const auth = await identity(); return (await new ProductService(auth).detail(await currentToken(), id, contextId)); }
