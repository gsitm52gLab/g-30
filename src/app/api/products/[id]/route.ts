import { route, json, readBody } from "@/server/http/identity";
import { ProductService } from "@/server/products/service";
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Context) { return route(request, async (identity, token) => json(await new ProductService(identity).detail(token, (await context.params).id, new URL(request.url).searchParams.get("context") ?? ""))); }
export async function POST(request: Request, context: Context) { return route(request, async (identity, token) => json(await new ProductService(identity).command(token, (await context.params).id, await readBody(request, ["contextId", "command", "idempotencyKey", "common", "fields", "files", "price", "expectedCommonRevision", "expectedContextRevision", "expectedPriceRevision", "targetContextId", "taskId", "expectedTaskRevision"], 262144)))); }
