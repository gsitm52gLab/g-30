import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { ctx, api, login, detail, tracing, screenshot, hash, get } from '../fixtures/inquiries';
import type { InquiryList } from '@/server/inquiries/contracts';
tracing();
test('I09-06 draft create lost response stable ID, attachment-only publish, native private file download and refresh', async ({ page }, info) => { test.setTimeout(90000); const admin = await api(); try {
    await login(page, 'team@example.test');
    await page.goto(`/inquiries/new?context=${ctx}`);
    let lose = true;
    const createKeys: string[] = [], ids: string[] = [];
    await page.route('**/api/inquiries', async (route) => { if (route.request().method() === 'POST') {
        createKeys.push(route.request().postDataJSON().idempotencyKey);
        const response = await route.fetch();
        ids.push((await response.json()).conversationId);
        if (lose) {
            lose = false;
            await route.abort('failed');
            return;
        }
        await route.fulfill({ response });
        return;
    } await route.continue(); });
    await page.getByRole('button', { name: '비공개 초안 만들기', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Failed to fetch');
    await expect.poll(() => ids.length).toBe(1);
    await page.reload();
    await page.getByRole('button', { name: '이전에 만든 문의 이어서 확인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '비공개 문의 초안', exact: true })).toBeVisible();
    expect(createKeys).toHaveLength(2);
    expect(new Set(createKeys).size).toBe(1);
    expect(new Set(ids).size).toBe(1);
    const id = ids[0];
    expect((await get<InquiryList>(admin, `/api/inquiries?context=${ctx}`)).items.some(x => x.id === id)).toBe(false);
    const name = '긴파일이름'.repeat(20) + '.csv', bytes = Buffer.from('kind,value\nATTACHMENT_ONLY,1\n');
    await page.getByRole('textbox', { name: '문의 제목', exact: true }).fill('첨부만 있는 첫 질문 ' + info.project.name);
    await page.getByLabel('대화 파일 추가', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
    await expect(page.getByText('업로드 완료', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: '문의 제목', exact: true })).toHaveValue('첨부만 있는 첫 질문 ' + info.project.name);
    await expect(page.getByText('업로드 완료', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '첫 질문 보내기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '전체 공개 대화', exact: true })).toBeVisible();
    const d = await detail(admin, id);
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0].body).toBe('');
    expect(d.messages[0].files).toHaveLength(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('region', { name: '공개 대화', exact: true }).getByRole('link', { name: '다운로드', exact: true }).click()]);
    const path = await download.path();
    expect(path).not.toBeNull();
    const actual = await readFile(path!);
    expect(hash(actual)).toBe(hash(bytes));
    expect(d.messages[0].files[0].sha256).toBe(hash(bytes));
    await writeFile(info.outputPath('draft-intent-download.json'), JSON.stringify({ createKeys, ids, sourceSha256: hash(bytes), downloadSha256: hash(actual), file: d.messages[0].files[0] }));
    await screenshot(page, info, 'attachment-only-long-filename');
}
finally {
    await admin.dispose();
} });
