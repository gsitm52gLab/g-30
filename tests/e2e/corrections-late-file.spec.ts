import { test, expect, type APIResponse } from '@playwright/test';
import { seed, login, open, button, field, mutate, ctx, png, retain, recordJSON, getWorkspace } from '../fixtures/corrections-ui';
test.beforeEach(async ({page}) => {await page.context().tracing.start({screenshots:true,snapshots:true,sources:true});});
test.afterEach(async ({ page }, info) => retain(page, info));
test('G10 UI-H actual successful private upload held then operator membership denial purges file memory and metadata', async ({ page, browser }, info) => { test.setTimeout(90000); const { id } = await seed(page); const adminContext = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT}` }), admin = await adminContext.newPage(); await login(admin); await login(page, 'operator@example.test'); await open(page, id); await button(page, '내부 의견').click(); await button(page, '새 내부 의견').click(); await field(page, '원문 출처').fill('LATE_PRIVATE_OPINION'); await page.getByLabel('내부 파일 선택', { exact: true }).setInputFiles({ name: 'LATE_PRIVATE_UPLOAD.png', mimeType: 'image/png', buffer: png() }); let release!: () => void, received!: (r: APIResponse) => void; const held = new Promise<void>(r => release = r), success = new Promise<APIResponse>(r => received = r); await page.route(`**/api/files?taskId=${id}`, async (route) => { const r = await route.fetch(); received(r); await held; await route.fulfill({ response: r }); }); try {
    await button(page, '대기 파일 업로드').click();
    const response = await success;
    expect(response.status()).toBe(201);
    const files = (await response.json()).files;
    const members = await (await admin.request.get(`/api/contexts/${ctx}/members`)).json(), m = members.members.find((m: {
        data: {
            userId: string;
        };
    }) => m.data.userId === 'user-gsg');
    expect((await mutate(admin.request, `/api/contexts/${ctx}/members/${m.id}`, { expectedRevision: m.revision, status: 'suspended' }, 'PATCH')).status()).toBe(200);
    await button(page, '최신 기록 재조회 · 입력 유지').click();
    await expect(page.getByRole('heading', { name: '수정·검토 접근 확인', exact: true })).toBeVisible();
    release();
    await expect(page.locator('body')).not.toContainText('LATE_PRIVATE');
    for (const f of files)
        await expect(page.locator('body')).not.toContainText(f.id);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:correction-recovery:')))).toEqual([]);
    expect((await getWorkspace(admin, id)).staff!.internalFiles).toHaveLength(1);
    await recordJSON(info, 'late-upload-denied', { files, deniedStatus: 404, createdOpinions: (await getWorkspace(admin, id)).staff!.opinions.length });
}
finally {
    release?.();
    await adminContext.close();
} });
