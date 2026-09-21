export class CampaignError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
}
export const denied = (error: unknown) => error instanceof CampaignError && [401, 403, 404].includes(error.status);
export async function request<T>(url: string, body?: unknown, active: () => boolean = () => true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
        const c = await request<{
            csrfToken: string;
        }>('/api/auth/csrf');
        if (!active())
            throw new Error('접근 상태가 바뀌어 요청을 중단했습니다.');
        headers['X-CSRF-Token'] = c.csrfToken;
        if (!(body instanceof FormData))
            headers['Content-Type'] = 'application/json';
    }
    if (!active())
        throw new Error('접근 상태를 다시 확인해 주세요.');
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }), data = await response.json().catch(() => null);
    if (!response.ok)
        throw new CampaignError(data?.error?.message ?? '연결을 확인하고 다시 시도해 주세요.', response.status, data?.error?.code ?? 'REQUEST_FAILED');
    if (data === null)
        throw new Error('응답을 확인하지 못했습니다. 같은 요청으로 재시도해 주세요.');
    return data as T;
}
