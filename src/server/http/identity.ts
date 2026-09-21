import "server-only";
import { NextResponse } from "next/server";
import { authConfig, identity } from "@/server/auth/runtime";
import { AuthError, fail, type IdentityService } from "@/server/auth/service";
import { StoreError } from "@/domain/records";
export function requestToken(request: Request) { const name = authConfig().cookieName; return request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1); }
export function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } }); }
export function sessionCookie(response: NextResponse, token: string, expiresAt: string) { const c = authConfig(); response.cookies.set(c.cookieName, token, { httpOnly: true, sameSite: "lax", secure: c.secure, path: "/", expires: new Date(expiresAt) }); }
export async function readBody(request: Request, keys: string[], limit = 16384) { if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail("VALIDATION", 422, "JSON 요청이 필요합니다.");
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > limit) {
                    await reader.cancel();
                    fail("VALIDATION", 422, "입력 내용이 너무 큽니다.");
                }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let body; try {
    body = JSON.parse(raw);
}
catch {
    fail("VALIDATION", 422, "입력 형식을 확인해 주세요.");
} if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k)))
    fail("VALIDATION", 422, "허용되지 않은 입력 항목입니다."); return body as Record<string, unknown>; }
export async function route(request: Request, action: (service: IdentityService, token: string | undefined) => Promise<Response>) { try {
    const service = await identity();
    const token = requestToken(request);
    if (!["GET", "HEAD"].includes(request.method)) {
        if (request.headers.get("origin") !== authConfig().origin)
            fail("CSRF", 403, "요청 출처를 확인할 수 없습니다.");
        await service.checkCsrf(token, request.headers.get("x-csrf-token"));
    }
    return await action(service, token);
}
catch (error) {
    if (error instanceof AuthError) {
        const response = json({ error: { code: error.code, message: error.status === 404 ? "자료를 찾을 수 없습니다." : error.message } }, error.status);
        if (error.status === 429) response.headers.set("Retry-After", "900");
        return response;
    }
    if (error instanceof StoreError) {
        const status = error.code === "CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_RECORD" ? 422 : 503;
        return json({ error: { code: error.code, message: status === 404 ? "자료를 찾을 수 없습니다." : status === 409 ? "이미 존재하거나 변경된 자료입니다. 새로고침해 주세요." : status === 503 ? "저장소를 사용할 수 없습니다. 입력을 유지한 채 다시 시도해 주세요." : "자료와 입력을 확인해 주세요." } }, status);
    }
    return json({ error: { code: "STORAGE_UNAVAILABLE", message: "처리하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요." } }, 503);
} }
