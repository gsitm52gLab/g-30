import { test, expect } from '@playwright/test';
import { seed, login, ctx, retain, capture, recordJSON } from '../fixtures/corrections-ui';
import type { MaterialTable } from '@/server/evidence/contracts';

test.beforeEach(async ({ page }) => { await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true }); });
test.afterEach(async ({ page }, info) => retain(page, info));
test('G10 UNION actual current and legacy task correction/inquiry entries coexist with G07 exact answer navigation', async ({ page }, info) => {
    const { id, v1 } = await seed(page);
    await login(page, 'team@example.test');
    for (const taskId of [id, 'task-onboarding']) {
        await page.goto(`/tasks/${taskId}?context=${ctx}`);
        await expect(page.getByRole('region', { name: '업무 연결 문의', exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: '업무 연결 문의', exact: true }).getByText('아직 전송된 문의가 없습니다', { exact: true })).toBeVisible();
        await page.getByRole('link', { name: '수정 취합·검토 기록 ↗', exact: true }).click();
        await expect(page.getByRole('heading', { name: '수정 취합과 사람 검토', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '내부 의견', exact: true })).toHaveCount(0);
    }
    const response = await page.request.get(`/api/evidence/table?context=${ctx}`);
    expect(response.status()).toBe(200);
    const table = await response.json() as MaterialTable;
    const cell = table.rows.find(r => r.productId === 'product-serum')!.cells.find(c => c.taskId === id && c.requirementKey === 'answer')!;
    expect(cell.submissionId).toBe(v1.id);
    expect(cell.submissionUrl).toBeTruthy();
    await page.goto(`/materials?context=${ctx}&productId=product-serum&taskId=${id}`);
    const link = page.getByRole('link', { name: '해당 제출·답변 원문 ↗', exact: true }).filter({ visible: true });
    await expect(link).toHaveCount(1);
    expect(await link.getAttribute('href')).toBe(cell.submissionUrl);
    await link.click();
    const historical = page.getByRole('region', { name: '링크로 선택한 과거 자료', exact: true });
    await expect(historical).toBeVisible();
    await expect(historical).toContainText('원본 v1');
    await expect(page.getByRole('region', { name: '업무 연결 문의', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '수정 취합·검토 기록 ↗', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('submissionId')).toBe(v1.id);
    await capture(page, info, 'g10-g09-g07-union');
    await recordJSON(info, 'actual-exact-cell', { taskId: id, requestId: v1.requestId, submissionId: v1.id, cell });
});
