'use client';
export const deniedEvent = 'gs-hale-g13-access-denied';
export class ScheduleError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
}
export const denied = (e: unknown) => e instanceof ScheduleError && [401, 403, 404].includes(e.status);
export function announceDenied(contextId: string) { window.dispatchEvent(new CustomEvent(deniedEvent, { detail: contextId })); }
export async function request<T>(url: string, body?: unknown, active: () => boolean = () => true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
        const csrf = await fetch('/api/auth/csrf', { cache: 'no-store' }), data = await csrf.json().catch(() => null);
        if (!csrf.ok)
            throw new ScheduleError(data?.error?.message ?? '로그인을 확인해 주세요.', csrf.status, data?.error?.code ?? 'AUTH');
        if (!active())
            throw new Error('화면이 변경되었습니다.');
        headers['X-CSRF-Token'] = data.csrfToken;
        headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    if (!r.ok)
        throw new ScheduleError(data?.error?.message ?? '연결을 확인한 뒤 다시 시도해 주세요.', r.status, data?.error?.code ?? 'REQUEST_FAILED');
    if (!data)
        throw new Error('응답을 읽지 못했습니다. 같은 요청으로 결과를 확인해 주세요.');
    return data as T;
}
export async function currentActor(contextId: string, expected?: string) {
    const me = await request<{
        user: {
            id: string;
        };
        contexts: {
            id: string;
        }[];
    }>('/api/auth/me');
    if ((expected && me.user.id !== expected) || !me.contexts.some(c => c.id === contextId))
        throw new ScheduleError('현재 계정과 컨텍스트 권한을 다시 확인해 주세요.', 403, 'SCOPE_CHANGED');
    return me.user.id;
}
