export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
    let csrf: string | undefined;
    if (method !== "GET") {
        const response = await fetch("/api/auth/csrf", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error?.message || "연결을 확인해 주세요.");
        csrf = data.csrfToken;
    }
    const response = await fetch(url, { method, cache: "no-store", headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf! }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error?.message || "저장하지 못했습니다.");
    return data;
}
