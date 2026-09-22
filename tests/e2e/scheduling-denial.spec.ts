import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setup, fillNew, mutation, journeys } from './support/g13';
journeys();
test('G13 UI-E actual logout while save200 held purges composer receipt storage and late state', async ({ page }, info) => { const x = await setup(page); await fillNew(page, x.taskId, 'REVOKED_SCHEDULE_COMPOSER'); let release!: () => void, reached!: () => void; const gate = new Promise<void>(r => release = r), ready = new Promise<void>(r => reached = r); await page.route('**/api/schedule', async (r) => { const response = await r.fetch(); expect(response.status()).toBe(200); reached(); await gate; await r.fulfill({ response }); }); try {
    await page.getByRole('button', { name: '일정 저장', exact: true }).click();
    await ready;
    expect((await mutation(page.request, '/api/auth/logout', {})).status()).toBe(200);
    const denied = page.waitForResponse(r => r.url().endsWith('/api/auth/me') && r.status() === 401);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await denied;
    await expect(page.getByRole('heading', { name: '일정을 볼 수 없습니다', exact: true })).toBeVisible();
    release();
    await expect(page.getByRole('textbox', { name: '일정 제목', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '저장 완료 · 최신 조회 확인', exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain('REVOKED_SCHEDULE_COMPOSER');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:g13:')))).toEqual([]);
    await writeFile(info.outputPath('denial.json'), JSON.stringify({ realCommit: 200, logout: 200, freshMe: 401 }));
}
finally {
    release?.();
} });
