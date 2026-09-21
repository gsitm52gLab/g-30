import { test, expect, request as apiRequest, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { ActiveConversationDetailDTO, ConversationDetailDTO, InquiryCommand, CreateConversationDraftResult } from '@/server/inquiries/contracts';
export const ctx = 'ctx-jp-a-luna';
export const origin = () => `http://127.0.0.1:${process.env.E2E_PORT}`;
export async function post(r: APIRequestContext, url: string, body: unknown, status = 200) { const csrf = await (await r.get('/api/auth/csrf')).json(); const response = await r.post(url, { data: body, headers: { Origin: origin(), 'X-CSRF-Token': csrf.csrfToken } }); expect(response.status(), `${url}: ${await response.text()}`).toBe(status); return response.json(); }
export async function get<T>(r: APIRequestContext, url: string): Promise<T> { const response = await r.get(url); expect(response.status(), `${url}: ${await response.text()}`).toBe(200); return response.json(); }
export async function api(email = 'admin@example.test') { const r = await apiRequest.newContext({ baseURL: origin() }); await post(r, '/api/auth/login', { email, password: 'Demo-Hale-2026!' }); return r; }
export async function login(page: Page, email = 'admin@example.test') { await page.context().clearCookies(); await page.goto('/login'); await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email); await page.getByLabel('비밀번호', { exact: true }).fill('Demo-Hale-2026!'); await page.getByRole('button', { name: '로그인', exact: true }).click(); await expect(page).toHaveURL(/\/$/); }
export async function detail(r: APIRequestContext, id: string) { return get<ActiveConversationDetailDTO>(r, `/api/inquiries/${id}`); }
export async function command(r: APIRequestContext, id: string, input: Omit<InquiryCommand, 'idempotencyKey'> | Record<string, unknown>) { return post(r, `/api/inquiries/${id}`, { ...input, idempotencyKey: randomUUID() }); }
export async function create(r: APIRequestContext, title = '합성 독립 문의', body = '첫 질문', taskId: string | null = null) { const d = await post(r, '/api/inquiries', { contextId: ctx, taskId, idempotencyKey: randomUUID() }, 201) as CreateConversationDraftResult; await command(r, d.conversationId, { command: 'publish_first', expectedRevision: d.revision, title, content: { clientMessageId: randomUUID(), body, fileVersionIds: [] } }); return d.conversationId; }
export async function question(r: APIRequestContext, id: string, body: string) { const d = await detail(r, id); await command(r, id, { command: 'question', expectedRevision: d.revision, content: { clientMessageId: randomUUID(), body, fileVersionIds: [] } }); }
export async function open(page: Page, id: string) { await page.goto(`/inquiries/${id}?context=${ctx}`); await expect(page.getByRole('region', { name: '문의 작성', exact: true })).toBeVisible(); }
const captures = new WeakMap<Page, {
    rows: {
        url: string;
        status: number;
        channel: string;
        body: string | null;
        unavailable?: string;
    }[];
    pending: Promise<void>[];
}>();
export function tracing() { test.use({ actionTimeout: 12000 }); test.beforeEach(async ({ page }) => { await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true }); const capture = { rows: [] as {
        url: string;
        status: number;
        channel: string;
        body: string | null;
        unavailable?: string;
    }[], pending: [] as Promise<void>[] }; captures.set(page, capture); page.on('response', response => { const headers = response.headers(), url = response.url(), rsc = (headers['content-type'] ?? '').includes('text/x-component'); if (!rsc || url.includes('/stream'))
    return; capture.pending.push((async () => { try {
    capture.rows.push({ url, status: response.status(), channel: 'actual-browser-RSC', body: await Promise.race([response.text(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Browser discarded/pending response body: NOT_VERIFIED')), 2000))]) });
}
catch (e) {
    capture.rows.push({ url, status: response.status(), channel: 'actual-browser-RSC', body: null, unavailable: String(e) });
} })()); }); }); test.afterEach(async ({ page }, info) => { const capture = captures.get(page); if (capture) {
    await Promise.allSettled(capture.pending);
    await writeFile(info.outputPath('actual-rsc-private.json'), JSON.stringify(capture.rows, null, 2));
} await writeFile(info.outputPath('final-dom-private.html'), await page.content()); await page.screenshot({ path: info.outputPath(info.status === info.expectedStatus ? 'final-private.png' : 'failure-private.png'), fullPage: true }); await page.context().tracing.stop({ path: info.outputPath('journey-private-trace.zip') }); }); }
export async function screenshot(page: Page, info: TestInfo, label: string) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(label + '-full-private.png'), fullPage: true }); if (info.project.name === 'mobile') {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(label + '-390-private.png') });
} }
export const content = (body: string) => ({ clientMessageId: randomUUID(), body, fileVersionIds: [] });
export async function snapshot(r: APIRequestContext, id: string, info: TestInfo, label: string) { const d = await get<ConversationDetailDTO>(r, `/api/inquiries/${id}`); await writeFile(info.outputPath(label + '-api-private.json'), JSON.stringify(d, null, 2)); return d; }
export const hash = (x: Uint8Array | string) => createHash('sha256').update(x).digest('hex');
