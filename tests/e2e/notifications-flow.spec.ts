import { test, expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { TaskDetail } from '@/server/tasks/service';
import type { NotificationList } from '@/server/notifications/contracts';
import { setup, login, json, mutation, journeys, ctx } from './support/g13';
journeys();
test('G13 UI-F normal task open focus self sync badge clicked RSC and notification read separate from task read', async ({ page }, info) => {
    test.setTimeout(120000);
    const x = await setup(page), admin = await page.context().browser()!.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT}`, storageState: await page.context().storageState() });
    try {
        await login(page, 'luna@example.test');
        await page.goto(`/tasks/${x.taskId}?context=${ctx}`);
        await expect(page.getByLabel('내 앱 알림')).toContainText('안 읽음');
        const before = await json<TaskDetail>(page.request, `/api/tasks/${x.taskId}?context=${ctx}`), initial = await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`);
        let d = await json<TaskDetail>(admin.request, `/api/tasks/${x.taskId}?context=${ctx}`);
        expect((await mutation(admin.request, `/api/tasks/${x.taskId}`, { command: 'save', expectedRevision: d.task.revision, idempotencyKey: randomUUID(), content: { ...x.content, title: '포커스로 수신할 실제 변경' } })).status()).toBe(200);
        d = await json(admin.request, `/api/tasks/${x.taskId}?context=${ctx}`);
        expect((await mutation(admin.request, `/api/tasks/${x.taskId}`, { command: 'publish', expectedRevision: d.task.revision, idempotencyKey: randomUUID() })).status()).toBe(200);
        const sync = page.waitForResponse(r => r.url().endsWith('/api/notifications/sync') && r.request().method() === 'POST');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        expect((await sync).status()).toBe(200);
        await expect.poll(async () => (await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).total).toBeGreaterThan(initial.total);
        const n = await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`);
        await expect(page.getByLabel('내 앱 알림')).toContainText(`안 읽음 ${n.unread}건`);
        const clickedRsc = page.waitForResponse(r => new URL(r.url()).pathname === '/notifications' && r.request().headers()['rsc'] === '1');
        await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: /알림/ }).click();
        await expect(page.getByRole('heading', { name: '알림', exact: true })).toBeVisible();
        const item = page.locator('li').filter({ has: page.getByRole('heading', { name: '포커스로 수신할 실제 변경', exact: true }) }).first();
        await expect(item).toBeVisible();
        await item.getByRole('button', { name: /읽음 표시$/ }).click();
        await expect(page.getByRole('status').filter({ hasText: '읽음 상태를 확인했습니다.' })).toBeVisible();
        const after = await json<TaskDetail>(page.request, `/api/tasks/${x.taskId}?context=${ctx}`);
        expect(after.activities.filter(a => ['read', 'accept'].includes(a.data.kind))).toEqual(before.activities.filter(a => ['read', 'accept'].includes(a.data.kind)));
        await expect(item.getByRole('button', { name: /안 읽음으로 표시$/ })).toBeVisible();
        await item.getByRole('button', { name: /안 읽음으로 표시$/ }).click();
        await expect(item.getByRole('button', { name: /읽음 표시$/ })).toBeVisible();
        const rsc = await clickedRsc, body = await rsc.body();
        expect(rsc.status()).toBe(200);
        expect(body.toString()).not.toContain('G13_PRIVATE_CANARY');
        await writeFile(info.outputPath(`native-clicked-rsc-${createHash('sha256').update(body).digest('hex')}.txt`), body);
        const nav = page.getByRole('navigation', { name: '주 메뉴', exact: true });
        await nav.getByRole('link', { name: /일정/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/schedule/);
        await nav.getByRole('link', { name: /알림/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/notifications/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
        await writeFile(info.outputPath('actual-notification-data.json'), JSON.stringify(await json(page.request, `/api/notifications?context=${ctx}`)));
    }
    finally {
        await admin.close();
    }
});
