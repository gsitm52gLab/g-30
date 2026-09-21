import { test, expect } from '@playwright/test';
import type { NotificationList } from '@/server/notifications/contracts';
import { setup, login, json, mutation, journeys, ctx } from './support/g13';
journeys();
test('G13 UI-H held actual sync response after membership revocation cannot restore protected list or counts', async ({ page }) => { const x = await setup(page); const admin = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT}`, storageState: await page.context().storageState() }); let release!: () => void; try {
    await login(page, 'luna@example.test');
    await page.goto(`/notifications?context=${ctx}`);
    await expect(page.getByText(/안 읽은 알림 \d+건/)).toBeVisible();
    const n = await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`);
    expect(n.total).toBeGreaterThan(0);
    let reached!: () => void;
    const held = new Promise<void>(r => release = r), ready = new Promise<void>(r => reached = r);
    await page.route('**/api/notifications/sync', async (r) => { const response = await r.fetch(); expect(response.status()).toBe(200); reached(); await held; await r.fulfill({ response }); });
    await page.getByRole('button', { name: '알림 다시 확인', exact: true }).click();
    await ready;
    const members = await json<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
                scope: string;
            };
        }[];
    }>(admin.request, `/api/contexts/${ctx}/members`), m = members.members.find(m => m.data.userId === 'user-luna')!;
    expect((await mutation(admin.request, `/api/contexts/${ctx}/members/${m.id}`, { expectedRevision: m.revision, status: 'suspended', scope: m.data.scope, internalPriceAccess: false }, 'PATCH')).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: '알림을 볼 수 없습니다', exact: true })).toBeVisible();
    release();
    await expect(page.getByText(/안 읽은 알림 \d+건/)).toHaveCount(0);
    expect(await page.content()).not.toContain(x.content.title);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:g13:')))).toEqual([]);
}
finally {
    release?.();
    await admin.close();
} });
