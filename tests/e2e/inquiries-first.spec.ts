import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ctx, api, login, detail, get, tracing, screenshot, snapshot } from '../fixtures/inquiries';
import type { InquiryList, InquiryUploadResult } from '@/server/inquiries/contracts';
tracing();
test('I09-01 private first draft, partial file failure retry only, canonical popup/detail/read and retained composer', async ({ page }, info) => { test.setTimeout(90000); const admin = await api(), peer = await api('co@example.test'); try {
    await login(page, 'team@example.test');
    await page.goto(`/inquiries?context=${ctx}`);
    await page.getByRole('link', { name: '새 문의 작성', exact: true }).click();
    await page.getByRole('button', { name: '비공개 초안 만들기', exact: true }).click();
    await expect(page).toHaveURL(/\/inquiries\/[a-f0-9-]+/);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('textbox', { name: '문의 제목', exact: true }).fill('브랜드 독립 문의 ' + info.project.name);
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('  원문 첫 줄\n둘째 줄  ');
    let injected = false;
    const uploadItems: number[] = [];
    await page.route(`**/api/inquiries/${id}/files?visibility=public`, async (route) => { const body = route.request().postDataBuffer()!.toString(); uploadItems.push((body.match(/name="clientItemIds"/g) || []).length); const response = await route.fetch(); const json = await response.json() as {
        items: InquiryUploadResult[];
    }; if (!injected && json.items.length === 2) {
        injected = true;
        json.items[1] = { clientItemId: json.items[1].clientItemId, state: 'failed', error: { code: 'STORAGE_UNAVAILABLE', message: '검사: 둘째 업로드 응답 유실', retryable: true } };
        await route.fulfill({ response, json });
    }
    else
        await route.fulfill({ response }); });
    await page.getByLabel('대화 파일 추가', { exact: true }).setInputFiles([{ name: 'first.csv', mimeType: 'text/csv', buffer: Buffer.from('kind,value\nfirst,1\n') }, { name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from('kind,value\nsecond,2\n') }]);
    await expect(page.getByText('검사: 둘째 업로드 응답 유실', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '첫 질문 보내기', exact: true })).toBeDisabled();
    expect((await get<InquiryList>(admin, `/api/inquiries?context=${ctx}`)).items.some(x => x.id === id)).toBe(false);
    expect((await admin.get(`/api/inquiries/${id}`)).status()).toBe(404);
    expect((await peer.get(`/api/inquiries/${id}`)).status()).toBe(404);
    await screenshot(page, info, 'first-file-failure');
    await page.getByRole('button', { name: '이 실패 파일만 재시도', exact: true }).click();
    await expect(page.getByText('검사: 둘째 업로드 응답 유실', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '첫 질문 보내기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '전체 공개 대화', exact: true })).toBeVisible();
    const d = await detail(admin, id);
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0].body).toBe('  원문 첫 줄\n둘째 줄  ');
    expect(d.messages[0].files).toHaveLength(2);
    expect(uploadItems).toEqual([2, 1]);
    expect((await peer.get(`/api/inquiries/${id}`)).status()).toBe(404);
    await page.getByRole('link', { name: '← 문의 목록', exact: true }).click();
    const opener = page.getByRole('button', { name: '대화 팝업 열기 · ' + d.title, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '문의 1:1 대화', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-message-id]')).toHaveCount(1);
    await expect(dialog.getByRole('link', { name: '다운로드', exact: true })).toHaveCount(2);
    await dialog.getByRole('button', { name: '여기까지 읽음 기록', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).reads.length).toBe(1);
    await dialog.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('팝업에서 작성 중 · 전송 전');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('팝업에서 작성 중 · 전송 전');
    await dialog.getByRole('link', { name: '전체 상세 열기', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('팝업에서 작성 중 · 전송 전');
    await expect(page.locator('[data-message-id]')).toHaveCount(1);
    await writeFile(info.outputPath('upload-item-counts.json'), JSON.stringify({ uploadItems, files: d.messages[0].files }));
    await snapshot(admin, id, info, 'first-canonical');
    await screenshot(page, info, 'canonical-detail');
}
finally {
    await admin.dispose();
    await peer.dispose();
} });
