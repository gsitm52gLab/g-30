import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ctx, api, login, create, detail, open, tracing, screenshot } from '../fixtures/inquiries';
tracing();
test('I09-07 internal UI file and acknowledgement do not answer; home error differs zero and real clicked RSC excludes memo', async ({ page }, info) => { test.setTimeout(90000); const brand = await api('team@example.test'), admin = await api(); try {
    const id = await create(brand, '내부와 공개 분리 ' + info.project.name);
    await login(page);
    await open(page, id);
    await page.getByRole('combobox', { name: '전송 동작', exact: true }).selectOption('acknowledgement');
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('확인했습니다. 아직 답변은 아닙니다.');
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).messages.length).toBe(2);
    await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('');
    expect((await detail(admin, id)).counts.unresolved).toBe(1);
    const before = await detail(brand, id);
    await page.getByRole('combobox', { name: '전송 동작', exact: true }).selectOption('internal_note');
    await page.getByRole('textbox', { name: '내부 메모 내용', exact: true }).fill('G09-INTERNAL-UI-CANARY');
    await page.getByLabel('내부 메모 파일 추가', { exact: true }).setInputFiles({ name: 'G09-INTERNAL-FILE.csv', mimeType: 'text/csv', buffer: Buffer.from('kind,value\nINTERNAL_ONLY,1\n') });
    await expect(page.getByText('업로드 완료', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '내부 메모 기록', exact: true }).click();
    await expect(page.getByRole('region', { name: 'GSG 내부 메모', exact: true })).toContainText('G09-INTERNAL-UI-CANARY');
    expect((await detail(admin, id)).counts.unresolved).toBe(1);
    const after = await detail(brand, id);
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.messages).toEqual(before.messages);
    await screenshot(page, info, 'gsg-internal-note');
    await login(page, 'team@example.test');
    await page.goto(`/inquiries?context=${ctx}`);
    const rsc: Promise<string>[] = [];
    page.on('response', r => { if ((r.headers()['content-type'] ?? '').includes('text/x-component'))
        rsc.push(Promise.race([r.text(), new Promise<string>((_, reject) => setTimeout(() => reject(Error('unavailable RSC body')), 2000))]).catch(() => '')); });
    await page.getByRole('link', { name: '내부와 공개 분리 ' + info.project.name + ' ↗', exact: true }).click();
    await expect(page.getByRole('region', { name: '공개 대화', exact: true })).toBeVisible();
    await expect(page.getByText('G09-INTERNAL-UI-CANARY', { exact: true })).toHaveCount(0);
    await expect(page.getByText('G09-INTERNAL-FILE.csv', { exact: true })).toHaveCount(0);
    const bodies = await Promise.all(rsc);
    expect(bodies.filter(Boolean).length).toBeGreaterThan(0);
    for (const body of bodies) {
        expect(body).not.toContain('G09-INTERNAL-UI-CANARY');
        expect(body).not.toContain('G09-INTERNAL-FILE.csv');
    }
    await writeFile(info.outputPath('clicked-brand-rsc.json'), JSON.stringify({ captured: bodies.filter(Boolean).length, unavailable: bodies.filter(x => !x).length, bodies }, null, 2));
    await page.route('**/api/inquiries?**', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: '검사: 문의 요약 조회 불가' } }) }));
    await page.goto(`/?context=${ctx}`);
    const home = page.getByRole('region', { name: '현재 컨텍스트 문의', exact: true });
    await expect(home.getByRole('alert')).toContainText('문의 요약 조회 불가');
    await expect(home.getByLabel('질문별 현황', { exact: true })).toHaveCount(0);
    await screenshot(page, info, 'home-error-not-zero');
}
finally {
    await brand.dispose();
    await admin.dispose();
} });
