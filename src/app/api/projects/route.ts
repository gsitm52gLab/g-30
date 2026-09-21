import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
export function POST(request: Request) { return route(request, async (identity, token) => json(await new TaskService(identity).createProject(token, await readBody(request, ["title", "target", "templateVersionIds", "idempotencyKey"], 262144)), 201)); }
