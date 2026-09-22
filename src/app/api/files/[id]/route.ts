import { route } from "@/server/http/identity";
import { FileService } from "@/server/files/service";
import { fileReference } from "@/server/files/access";
import { fail } from "@/server/auth/errors";
export const runtime = "nodejs";
export async function GET(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) {
    return route(request, async (identity, token) => {
        const url = new URL(request.url), mode = url.searchParams.get("mode") ?? "download";
        if (!["download", "original", "preview"].includes(mode))
            fail("VALIDATION", 422, "파일 동작을 확인해 주세요.");
        const { bytes, metadata } = await new FileService(identity).download(token, (await context.params).id, fileReference(url.searchParams), mode as "download" | "original" | "preview");
        return new Response(bytes, { headers: { "Content-Type": metadata.mime, "Content-Length": String(bytes.length), "Content-Disposition": `${mode === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Referrer-Policy": "no-referrer" } });
    });
}
