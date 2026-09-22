import { route, json, readBody } from "@/server/http/identity";
import { TaskService } from "@/server/tasks/service";
import { fail } from "@/server/auth/errors";
export async function POST(request: Request) {
    return route(request, async (identity, token) => {
        const body = await readBody(request, ["command", "contextId", "name", "previousId", "content", "versionId", "targets", "idempotencyKey"], 262144);
        const service = new TaskService(identity);
        if (body.command === "save")
            return json(await service.saveTemplate(token, body), 201);
        if (body.command === "apply")
            return json(await service.applyTemplate(token, body));
        if (body.command === "preview_apply")
            return json(await service.previewTemplate(token, body));
        fail("VALIDATION", 422, "템플릿 작업을 확인해 주세요.");
    });
}
