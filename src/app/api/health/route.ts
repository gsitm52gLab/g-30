import { getRepository } from "@/server/repositories";
export const dynamic = "force-dynamic";
export async function GET() {
    try {
        const repository = await getRepository();
        await repository.list("context");
        return Response.json({ status: "ok", phase: "G01", authentication: "server_session", ai: "not_connected" });
    }
    catch {
        return Response.json({ status: "unavailable", code: "STORAGE_OR_CONFIGURATION_ERROR" }, { status: 503 });
    }
}
