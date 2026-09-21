import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
type Params = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Params) { return route(request, async (identity, token) => json(await new TaskService(identity).detail(token, (await context.params).id, new URL(request.url).searchParams.get("context") ?? undefined))); }
export function POST(request: Request, context: Params) { return route(request, async (identity, token) => json(await new TaskService(identity).command(token, (await context.params).id, await readBody(request, ["command", "expectedRevision", "idempotencyKey", "content", "assignment", "reason", "deadline", "activityId", "decision", "cycle", "productIds"], 262144)))); }
