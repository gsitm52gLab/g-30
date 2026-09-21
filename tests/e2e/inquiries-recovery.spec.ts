import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { api, login, create, detail, open, tracing, screenshot, snapshot } from '../fixtures/inquiries';
tracing();
test('I09-03 lost send response same intent and known POST-success GET-failure reread only survive refresh', async ({ page }, info) => { test.setTimeout(90000); const brand = await api('team@example.test'), admin = await api(); try {
    const id = await create(brand, '전송 복구 ' + info.project.name);
    await login(page, 'team@example.test');
    await open(page, id);
    const intents: string[] = [], messages: string[] = [];
    let lose = true;
    await page.route(`**/api/inquiries/${id}`, async (route) => { if (route.request().method() === 'POST') {
        const b = route.request().postDataJSON();
        if (b.command === 'message') {
            intents.push(b.idempotencyKey);
            messages.push(b.content.clientMessageId);
            if (lose) {
                lose = false;
                const response = await route.fetch();
                expect(response.status()).toBe(200);
                await route.abort('failed');
                return;
            }
        }
    } await route.continue(); });
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('응답 유실이어도 한번만 전송');
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
    await expect(page.getByRole('button', { name: '동일 전송 다시 시도', exact: true })).toBeVisible();
    await expect.poll(async () => (await detail(admin, id)).messages.length).toBe(2);
    await page.reload();
    await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('응답 유실이어도 한번만 전송');
    await page.getByRole('button', { name: '동일 전송 다시 시도', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('');
    expect(intents).toHaveLength(2);
    expect(new Set(intents).size).toBe(1);
    expect(new Set(messages).size).toBe(1);
    expect((await detail(admin, id)).messages).toHaveLength(2);
    await page.unroute(`**/api/inquiries/${id}`);
    let fails = false, posts = 0;
    await page.route(`**/api/inquiries/${id}`, async (route) => { if (route.request().method() === 'POST') {
        posts++;
        const response = await route.fetch();
        fails = true;
        await route.fulfill({ response });
        return;
    } if (fails) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: '검사: 전송 성공 뒤 조회 실패' } }) });
        return;
    } await route.continue(); });
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('기록 후 조회만 실패');
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
    await expect(page.getByRole('button', { name: '저장 결과 다시 읽기', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '동일 전송 다시 시도', exact: true })).toBeDisabled();
    await screenshot(page, info, 'committed-result-recovery');
    fails = false;
    await page.getByRole('button', { name: '저장 결과 다시 읽기', exact: true }).click();
    await expect(page.getByRole('button', { name: '저장 결과 다시 읽기', exact: true })).toHaveCount(0);
    expect(posts).toBe(1);
    expect((await detail(admin, id)).messages).toHaveLength(3);
    await writeFile(info.outputPath('actual-intents.json'), JSON.stringify({ intents, messages, posts }));
    await snapshot(admin, id, info, 'recovery');
}
finally {
    await brand.dispose();
    await admin.dispose();
} });
