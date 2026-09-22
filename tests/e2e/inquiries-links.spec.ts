import { test, expect } from '@playwright/test';
import { ctx, api, login, create, detail, open, tracing, screenshot, get } from '../fixtures/inquiries';
import type { TaskCatalog } from '@/server/tasks/service';
tracing();
test('I09-05 actual task creation association failure keeps created ID and only retries link; both task entry versions', async ({ page }, info) => { test.setTimeout(90000); const brand = await api('team@example.test'), admin = await api(); try {
    const id = await create(brand, '업무 전환 문의 ' + info.project.name);
    await login(page);
    await open(page, id);
    const before = await get<TaskCatalog>(admin, `/api/tasks?context=${ctx}`);
    await page.getByRole('button', { name: '연결할 업무 불러오기', exact: true }).click();
    await page.getByRole('button', { name: '이 문의에서 요청 업무 만들기', exact: true }).click();
    const form = page.getByRole('region', { name: '문의 연결 업무 만들기', exact: true });
    await expect(form.getByRole('combobox', { name: '다른 컨텍스트에도 독립 업무 만들기', exact: true })).toHaveCount(0);
    await form.getByRole('textbox', { name: '업무 제목', exact: true }).fill('문의에서 실제 요청 생성');
    await form.getByRole('textbox', { name: '공개 설명', exact: true }).fill('대화는 원본에 남음');
    await form.getByRole('combobox', { name: 'GSG 책임자', exact: true }).selectOption('user-gsg');
    await form.getByRole('combobox', { name: '브랜드 주담당', exact: true }).selectOption('user-luna');
    let fail = true;
    await page.route(`**/api/inquiries/${id}`, async (route) => { if (route.request().method() === 'POST' && route.request().postDataJSON().command === 'link_task' && fail) {
        fail = false;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: '검사: 업무 생성 뒤 연결 충돌' } }) });
        return;
    } await route.continue(); });
    await form.getByRole('button', { name: '초안 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '이미 만든 업무 · 문의 연결 확인 필요', exact: true })).toBeVisible();
    const created = (await get<TaskCatalog>(admin, `/api/tasks?context=${ctx}`)).tasks.filter(t => !before.tasks.some(x => x.id === t.id));
    expect(created).toHaveLength(1);
    await expect(page.getByRole('link', { name: '생성한 업무 열기 ↗', exact: true })).toHaveAttribute('href', `/tasks/${created[0].id}?context=${ctx}`);
    await screenshot(page, info, 'task-created-link-failed');
    await page.reload();
    await expect(page.getByRole('heading', { name: '이미 만든 업무 · 문의 연결 확인 필요', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이미 만든 업무 연결만 다시 시도', exact: true }).click();
    await expect.poll(async () => (await detail(admin, id)).task?.id).toBe(created[0].id);
    expect((await get<TaskCatalog>(admin, `/api/tasks?context=${ctx}`)).tasks).toHaveLength(before.tasks.length + 1);
    expect((await detail(admin, id)).messages).toHaveLength(1);
    expect((await detail(brand, id)).task).toBeNull();
    await page.getByRole('link', { name: '생성한 업무 열기 ↗', exact: true }).click();
    await expect(page.getByRole('region', { name: '업무 연결 문의', exact: true })).toContainText('업무 전환 문의');
    await screenshot(page, info, 'schema-v2-task-entry');
    const legacy = before.tasks.find(t => t.data.schemaVersion !== 2)!;
    await page.goto(`/tasks/${legacy.id}?context=${ctx}`);
    await expect(page.getByRole('region', { name: '업무 연결 문의', exact: true })).toBeVisible();
}
finally {
    await brand.dispose();
    await admin.dispose();
} });
