import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return (await route(request, async (identity, token) => json(await new TaskService(identity).catalog(token, new URL(request.url).searchParams.get("context") ?? "")))); }
export async function POST(request: Request) { return (await route(request, async (identity, token) => json(await new TaskService(identity).create(token, await readBody(request, ["targets", "content", "category", "projectId", "templateVersionId", "subtype", "idempotencyKey"], 262144)), 201))); }
