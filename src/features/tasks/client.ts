"use client";
import { useRef, useState } from "react";
export class RequestError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
}
export async function request<T>(url: string, body?: Record<string, unknown> | FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
        const csrf = await fetch("/api/auth/csrf", { cache: "no-store" });
        const token = await csrf.json();
        if (!csrf.ok) throw new RequestError(token.error?.message || "로그인을 확인해 주세요.", csrf.status, token.error?.code || "AUTH");
        headers["X-CSRF-Token"] = token.csrfToken;
        if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
    }
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new RequestError(data?.error?.message || "연결을 확인한 뒤 다시 시도해 주세요. 입력은 유지됩니다.", response.status, data?.error?.code || "REQUEST_FAILED");
    if (!data) throw new Error("서버 응답을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.");
    return data as T;
}
/** Keep the key on an ambiguous failure; body changes intentionally start a new command. */
export function useCommand() {
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
    const locked = useRef(false), receipt = useRef({ fingerprint: "", key: "" });
    async function run<T>(url: string, input: Record<string, unknown>, after: (result: T) => Promise<void> | void, success = "저장했습니다.") {
        if (locked.current) return;
        locked.current = true; setBusy(true); setError(""); setMessage("");
        const fingerprint = url + JSON.stringify(input);
        if (receipt.current.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
        try {
            const result = await request<T>(url, { ...input, idempotencyKey: receipt.current.key });
            await after(result); receipt.current = { fingerprint: "", key: "" }; setMessage(success);
        } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다. 입력은 유지됩니다."); }
        finally { locked.current = false; setBusy(false); }
    }
    return { busy, error, message, run, setError, setMessage };
}
