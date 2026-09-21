'use client';
import { request, RequestError } from '@/features/tasks/client';
export { RequestError };
export const changedEvent = 'gs-hale:inquiry-changed', deniedEvent = 'gs-hale:inquiry-denied';
export function denied(e: unknown) { return e instanceof RequestError && [401, 403, 404].includes(e.status); }
export function errorText(e: unknown) { return e instanceof Error ? e.message : '연결을 확인한 뒤 다시 시도해 주세요.'; }
export async function api<T>(url: string, body?: Record<string, unknown> | FormData): Promise<T> { try {
    return await request<T>(url, body);
}
catch (e) {
    if (denied(e))
        window.dispatchEvent(new CustomEvent(deniedEvent));
    throw e;
} }
export async function actor() { return (await api<{
    user: {
        id: string;
    };
}>('/api/auth/me')).user.id; }
export const inquiryUrl = (id: string, context: string) => `/inquiries/${encodeURIComponent(id)}?context=${encodeURIComponent(context)}`;
export function changed() { window.dispatchEvent(new Event(changedEvent)); }
