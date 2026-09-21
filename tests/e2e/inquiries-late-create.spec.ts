import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ctx, api, login, tracing, get, origin } from '../fixtures/inquiries';
tracing();
test('I09-09 late private draft create after denial does not restore ID/storage or navigate', async ({ page }, info) => { const admin = await api(); let release = () => { }; const gate = new Promise<void>(r => { release = r; }); try {
    await login(page, 'team@example.test');
    await page.goto(`/inquiries/new?context=${ctx}`);
    let held = false, body: unknown;
    await page.route('**/api/inquiries', async (route) => { if (route.request().method() === 'POST') {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        body = await response.json();
        held = true;
        await gate;
        await route.fulfill({ response });
        return;
    } await route.continue(); });
    await page.getByRole('button', { name: '비공개 초안 만들기', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const members = await get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
            };
        }[];
    }>(admin, `/api/contexts/${ctx}/members`), m = members.members.find(m => m.data.userId === 'user-team')!;
    const csrf = await (await admin.get('/api/auth/csrf')).json();
    expect((await admin.patch(`/api/contexts/${ctx}/members/${m.id}`, { headers: { Origin: origin(), 'X-CSRF-Token': csrf.csrfToken }, data: { expectedRevision: m.revision, status: 'suspended' } })).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('main').getByRole('alert')).toContainText('보관 정보를 지웠습니다');
    const delivered = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/inquiries');
    release();
    await delivered;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(`/inquiries/new?context=${ctx}`);
    await expect(page.getByText(/생성한 문의 ID:/)).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:inquiry:')))).toEqual([]);
    await writeFile(info.outputPath('late-create-success.json'), JSON.stringify({ body, url: page.url() }));
}
finally {
    release();
    await admin.dispose();
} });
test('I09-10 late create after navigating away cannot navigate back or overwrite the new screen', async ({ page }, info) => { await login(page, 'co@example.test'); await page.goto(`/inquiries/new?context=${ctx}`); let release = () => { }; const gate = new Promise<void>(r => { release = r; }); let held = false; try {
    await page.route('**/api/inquiries', async (route) => { if (route.request().method() === 'POST') {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        held = true;
        await gate;
        await route.fulfill({ response });
        return;
    } await route.continue(); });
    await page.getByRole('button', { name: '비공개 초안 만들기', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await page.getByRole('link', { name: '← 문의 목록', exact: true }).click();
    await expect(page).toHaveURL(`/inquiries?context=${ctx}`);
    const delivered = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/inquiries');
    release();
    await delivered;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(`/inquiries?context=${ctx}`);
    await expect(page.getByRole('heading', { name: '문의', exact: true })).toBeVisible();
    await writeFile(info.outputPath('late-create-unmounted.json'), JSON.stringify({ held, url: page.url() }));
}
finally {
    release();
} });
