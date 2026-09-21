import { test, expect, type APIResponse } from '@playwright/test';
import { seed, seedBatch, login, produce, open, button, field, chooseTarget, mutate, ctx, getWorkspace, retain, recordJSON } from '../fixtures/corrections-ui';
test.beforeEach(async ({page}) => {await page.context().tracing.start({screenshots:true,snapshots:true,sources:true});});
test.afterEach(async ({ page }, info) => retain(page, info));
test('G10 UI-G actual successful reflection held then membership denial cannot restore committed ids or inputs', async ({ page, browser }, info) => { test.setTimeout(90000); const { id, v1 } = await seed(page); await seedBatch(page, v1, 1); const adminContext = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT}` }); const admin = await adminContext.newPage(); await login(admin); await login(page, 'luna@example.test'); const v2 = await produce(page, id, '반영 후속'); await open(page, id); const item = page.getByRole('region', { name: '공개 항목 1', exact: true }); await item.getByRole('checkbox', { name: '항목 1 반영 대상으로 선택', exact: true }).check(); await chooseTarget(item, v2); await field(item, '반영 설명 1').fill('LATE_G10_PROTECTED_COMPOSER'); let release!: () => void, received!: (r: APIResponse) => void; const held = new Promise<void>(r => release = r), success = new Promise<APIResponse>(r => received = r); await page.route('**/api/corrections', async (route) => { const r = await route.fetch(); received(r); await held; await route.fulfill({ response: r }); }); try {
    await button(page, '선택한 1개 항목 반영 제출').click();
    const response = await success;
    expect(response.status()).toBe(200);
    const ids = (await response.json()).ids;
    const members = await (await admin.request.get(`/api/contexts/${ctx}/members`)).json(), m = members.members.find((m: {
        data: {
            userId: string;
        };
    }) => m.data.userId === 'user-luna');
    expect((await mutate(admin.request, `/api/contexts/${ctx}/members/${m.id}`, { expectedRevision: m.revision, status: 'suspended' }, 'PATCH')).status()).toBe(200);
    const denied = page.waitForResponse(r => r.url().includes(`/api/corrections?taskId=${id}`) && r.status() === 404);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await denied;
    await expect(page.getByRole('heading', { name: '수정·검토 접근 확인', exact: true })).toBeVisible();
    release();
    await expect(page.locator('body')).not.toContainText('LATE_G10_PROTECTED_COMPOSER');
    for (const id of ids)
        await expect(page.locator('body')).not.toContainText(id);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:correction-recovery:')))).toEqual([]);
    await expect(page.getByRole('region', { name: '명령 복구' })).toHaveCount(0);
    const authoritative = await getWorkspace(admin, id);
    expect(authoritative.batches[0].items[0].history.reflections).toHaveLength(1);
    await recordJSON(info, 'late-send-currentauth', { ids, deniedStatus: 404, actual: authoritative.batches[0].items[0] });
}
finally {
    release?.();
    await adminContext.close();
} });
