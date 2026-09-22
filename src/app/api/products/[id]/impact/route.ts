import { route, json, readBody } from "@/server/http/identity";
import { ProductService } from "@/server/products/service";
export async function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (identity, token) => json(await new ProductService(identity).impact(token, (await context.params).id, await readBody(request, ["contextId", "common", "expectedCommonRevision"], 262144)))); }
