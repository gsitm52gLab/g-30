import { afterEach, expect, it, vi } from "vitest";
import { authConfig } from "@/server/auth/runtime";
import { json, sessionCookie, requestToken, readBody } from "@/server/http/identity";

afterEach(() => vi.unstubAllEnvs());

it("T12: default Origin remains 3000; HTTPS cookies are Secure without leaking tokens in JSON", () => {
    vi.stubEnv("APP_ORIGIN", ""); vi.stubEnv("SESSION_COOKIE_NAME", "");
    expect(authConfig().origin).toBe("http://127.0.0.1:3000");
    vi.stubEnv("APP_ORIGIN", "https://demo.example");
    vi.stubEnv("SESSION_COOKIE_NAME", "synthetic_https");
    const response = json({ ok: true });
    sessionCookie(response, "synthetic-cookie", "2050-01-01T00:00:00.000Z");
    expect(response.headers.get("set-cookie")).toMatch(/secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/httponly/i);
    expect(response.headers.get("set-cookie")).toMatch(/samesite=lax/i);
    expect(response.headers.get("cache-control")).toContain("no-store");
});

it("T13: cookie extraction uses exact namespace, never a substring or forwarded role", () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:4121");
    vi.stubEnv("SESSION_COOKIE_NAME", "gs_hale_g02_4121");
    expect(requestToken(new Request("http://127.0.0.1:4121", { headers: { Cookie: "other_gs_hale_g02_4121=bad; gs_hale_g02_aux_4124=bad", "X-Role": "admin" } }))).toBeUndefined();
    expect(requestToken(new Request("http://127.0.0.1:4121", { headers: { Cookie: "gs_hale_g02_4121=synthetic" } }))).toBe("synthetic");
});

it("T14: streaming body limit cancels oversized input before JSON/credential processing", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(17000)); },
        cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit);
    await expect(readBody(request, ["email"])).rejects.toMatchObject({ status: 422 });
    expect(cancelled).toBe(true);
});

it("T03/T14: JSON allowlist rejects arrays, malformed JSON, prototype/actor fields", async () => {
    for (const raw of ['[]', '{', '{"__proto__":{}}', '{"actorId":"user-admin"}']) {
        const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw });
        await expect(readBody(request, ["email"])).rejects.toMatchObject({ status: 422 });
    }
});
