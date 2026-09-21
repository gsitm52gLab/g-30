import { test, expect } from '@playwright/test';
import { ctx, api, login, create, question, detail, open, tracing, screenshot, snapshot } from '../fixtures/inquiries';
tracing();
test('I09-02 five questions four explicit answers one external wait on both sides/home; resolved then new question reopens', async ({ page }, info) => { test.setTimeout(120000); const brand = await api('team@example.test'), admin = await api(); try {
    const id = await create(brand, '다섯 질문 ' + info.project.name, '질문 1');
    for (let i = 2; i <= 5; i++)
        await question(brand, id, `질문 ${i}`);
    await login(page);
    await open(page, id);
    for (let i = 1; i <= 4; i++) {
        await page.getByRole('button', { name: `질문 ${i}에 답변 작성`, exact: true }).click();
        await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill(`답변 ${i}`);
        await page.getByRole('button', { name: '선택 질문에 명시 답변', exact: true }).click();
        await expect.poll(async () => (await detail(admin, id)).counts.answered).toBe(i);
        await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveValue('');
    }
    const d = await detail(admin, id), q5 = page.locator(`[data-question-id="${d.questions[4].id}"]`);
    await q5.getByText('질문 상태·외부 확인 기록', { exact: true }).click();
    await q5.getByRole('combobox', { name: '질문 상태', exact: true }).selectOption('external_waiting');
    await q5.getByRole('textbox', { name: '상태 변경 사유', exact: true }).fill('외부 일정 확인 필요');
    await q5.getByRole('textbox', { name: '외부 확인 상대', exact: true }).fill('합성 리테일러 담당');
    await q5.getByRole('combobox', { name: '현재 확인 책임자', exact: true }).selectOption('user-gsg');
    await q5.getByLabel('다음 확인일', { exact: true }).fill('2026-10-05');
    await q5.getByRole('textbox', { name: '최신 외부 확인 결과', exact: true }).fill('회신 대기');
    await q5.getByRole('button', { name: '질문 상태 기록', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).counts).toEqual({ questions: 5, answered: 4, unresolved: 1, waitingGsg: 0, waitingBrand: 0, externalWaiting: 1 });
    await expect(q5).toContainText('2026-10-05');
    await page.goto(`/?context=${ctx}`);
    const home = page.getByRole('region', { name: '현재 컨텍스트 문의', exact: true });
    await expect(home).toContainText('질문 5 · 답변 완료 4 · 남은 질문 1');
    await expect(home).toContainText('2026-10-05');
    await screenshot(page, info, 'home-five-four-one');
    await login(page, 'team@example.test');
    await open(page, id);
    await expect(page.getByRole('region', { name: '질문별 진행', exact: true })).toContainText('합성 리테일러 담당');
    await expect(page.getByRole('region', { name: '질문별 진행', exact: true })).toContainText('회신 대기');
    await screenshot(page, info, 'brand-external-wait');
    await login(page);
    await open(page, id);
    await page.getByRole('button', { name: '질문 5에 답변 작성', exact: true }).click();
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('외부 일정 최종 확인');
    await page.getByRole('button', { name: '선택 질문에 명시 답변', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).counts.unresolved).toBe(0);
    const resolved = (await detail(admin, id)).lastResolvedAt;
    expect(resolved).not.toBeNull();
    await login(page, 'team@example.test');
    await open(page, id);
    await page.getByRole('combobox', { name: '전송 동작', exact: true }).selectOption('question');
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('해결 후 새 질문');
    await page.getByRole('button', { name: '새 질문 보내기', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).counts).toEqual({ questions: 6, answered: 5, unresolved: 1, waitingGsg: 1, waitingBrand: 0, externalWaiting: 0 });
    expect((await detail(admin, id)).lastResolvedAt).toBe(resolved);
    await snapshot(admin, id, info, 'reopened');
    await screenshot(page, info, 'reopened-history');
}
finally {
    await brand.dispose();
    await admin.dispose();
} });
