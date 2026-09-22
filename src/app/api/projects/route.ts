import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
export async function POST(request: Request) { return (await route(request, async (identity, token) => json(await new TaskService(identity).createProject(token, await readBody(request, ["title", "target", "templateVersionIds", "idempotencyKey"], 262144)), 201))); }
