import { route, json, readBody } from "@/server/http/identity";
import { ProductService, type ProductListQuery } from "@/server/products/service";
export function GET(request: Request) {
    return route(request, async (identity, token) => {
        const params = new URL(request.url).searchParams, query: ProductListQuery = {};
        for (const key of ["context", "q", "country", "retailer", "brand", "sku", "category", "status", "page", "pageSize"] as const) {
            const value = params.get(key);
            if (value !== null)
                query[key] = value;
        }
        return json(await new ProductService(identity).list(token, query));
    });
}
export function POST(request: Request) { return route(request, async (identity, token) => json(await new ProductService(identity).create(token, await readBody(request, ["contextId", "brandId", "common", "fields", "idempotencyKey"], 262144)), 201)); }
