import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
type Params = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Params) { return (await route(request, async (identity, token) => json(await new TaskService(identity).project(token, (await context.params).id)))); }
export async function POST(request: Request, context: Params) { return (await route(request, async (identity, token) => json(await new TaskService(identity).dependencies(token, (await context.params).id, await readBody(request, ["expectedRevision", "dependencies", "idempotencyKey"], 262144))))); }
