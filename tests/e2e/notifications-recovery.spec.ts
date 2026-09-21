import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { NotificationList } from '@/server/notifications/contracts';
import { setup, login, json, mutation, journeys, ctx } from './support/g13';
journeys();
test('G13 UI-G read lost response exact retry then CAS explicit rebase and successful POST failed GET', async ({ page }) => {
    test.setTimeout(120000);
    await setup(page);
    await login(page, 'luna@example.test');
    await page.goto(`/notifications?context=${ctx}`);
    await expect(page.getByText(/안 읽은 알림 \d+건/)).toBeVisible();
    const n = (await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items[0];
    let first = true;
    let lost!: () => void;
    const lostResponse = new Promise<void>(r => lost = r);
    const bodies: string[] = [];
    await page.route(`**/api/notifications/${n.id}/read`, async (r) => {
        bodies.push(r.request().postData()!);
        if (first) {
            first = false;
            const response = await r.fetch();
            expect(response.status()).toBe(200);
            await r.abort('failed');
            lost();
        }
        else
            await r.continue();
    });
    await page.getByRole('button', { name: `${n.title} 읽음 표시`, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '읽음 요청 결과 확인', exact: true })).toBeVisible();
    await lostResponse;
    await expect(page.getByRole('alert').filter({ hasText: 'Failed to fetch' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '같은 요청으로 확인', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '읽음 상태를 확인했습니다.' })).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    await page.unroute(`**/api/notifications/${n.id}/read`);
    const latest = (await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items.find(i => i.id === n.id)!;
    expect((await mutation(page.request, `/api/notifications/${n.id}/read`, { read: false, expectedRevision: latest.revision, idempotencyKey: randomUUID() })).status()).toBe(200);
    await page.getByRole('button', { name: `${n.title} 안 읽음으로 표시`, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '읽음 상태 동시 수정', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '최신 상태 확인·기준 선택', exact: true }).click();
    await page.getByRole('button', { name: '같은 요청으로 확인', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '읽음 상태를 확인했습니다.' })).toBeVisible();
    let committed = false, posts = 0;
    await page.route(`**/api/notifications/${n.id}/read`, async (r) => { posts++; const response = await r.fetch(); expect(response.status()).toBe(200); committed = true; await r.fulfill({ response }); });
    await page.route('**/api/notifications?*', async (r) => {
        if (committed) {
            committed = false;
            await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_READ_FAILURE', message: '읽음 저장 후 합성 조회 실패' } }) });
        }
        else
            await r.continue();
    });
    await page.getByRole('button', { name: `${n.title} 읽음 표시`, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '저장 완료 · 조회 확인', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '저장 상태 다시 조회', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '읽음 상태를 확인했습니다.' })).toBeVisible();
    expect(posts).toBe(1);
});
