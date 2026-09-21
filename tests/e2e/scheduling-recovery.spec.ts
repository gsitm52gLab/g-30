import { test, expect } from '@playwright/test';
import type { ScheduleDetail } from '@/server/scheduling/contracts';
import { setup, fillNew, saved, find, json, open, revise, schedule, journeys } from './support/g13';
journeys();
test('G13 UI-C lost successful response exact same key body once and committed GET failure reload', async ({ page }) => { test.setTimeout(90000); const x = await setup(page); await fillNew(page, x.taskId, '분실 응답 복구'); const bodies: string[] = []; let first = true; await page.route('**/api/schedule', async (r) => { if (r.request().method() === 'POST') {
    bodies.push(r.request().postData()!);
    if (first) {
        first = false;
        const response = await r.fetch();
        expect(response.status()).toBe(200);
        await r.abort('failed');
        return;
    }
} await r.continue(); }); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await expect(page.getByRole('heading', { name: '요청 결과 확인 필요', exact: true })).toBeVisible(); await page.reload(); await page.getByRole('button', { name: '작성·요청 복구', exact: true }).click(); await page.getByRole('button', { name: '같은 요청으로 다시 확인', exact: true }).click(); await saved(page); expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]); const id = await find(page, '분실 응답 복구'); expect((await json<ScheduleDetail>(page.request, `/api/schedule/${id}`)).versions).toHaveLength(1); await page.unroute('**/api/schedule'); await open(page, id); await page.getByRole('textbox', { name: '일정 제목', exact: true }).fill('조회 실패 복구'); let committed = false, posts = 0; await page.route('**/api/schedule', async (r) => { posts++; const response = await r.fetch(); expect(response.status()).toBe(200); committed = true; await r.fulfill({ response }); }); await page.route(`**/api/schedule/${id}`, async (r) => { if (committed) {
    committed = false;
    await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_READ_FAILURE', message: '저장 후 합성 조회 실패' } }) });
}
else
    await r.continue(); }); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await expect(page.getByRole('heading', { name: '저장 완료 · 최신 조회 확인', exact: true })).toBeVisible(); await page.reload(); await page.getByRole('button', { name: '작성·요청 복구', exact: true }).click(); await page.getByRole('button', { name: '저장 결과 다시 조회', exact: true }).click(); await saved(page); expect(posts).toBe(1); expect((await json<ScheduleDetail>(page.request, `/api/schedule/${id}`)).versions).toHaveLength(2); });
test('G13 UI-D 409 preserves draft and old revision until explicit current rebase', async ({ page }) => { const x = await setup(page), id = await schedule(page, x.taskId); await open(page, id); await page.getByRole('textbox', { name: '일정 제목', exact: true }).fill('보존할 내 제목'); const newer = await revise(page, id, { title: '다른 작성자의 제목' }); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await expect(page.getByRole('heading', { name: '동시 수정 · 기준 확인', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: '일정 제목', exact: true })).toHaveValue('보존할 내 제목'); const savedPending = await page.evaluate(() => Object.values(sessionStorage).map(v => { try {
    return JSON.parse(v);
}
catch {
    return null;
} }).find(x => x?.pending?.body?.command === 'save')?.pending); expect(savedPending.body.expectedRevision).toBe(newer.revision - 1); await page.getByRole('button', { name: '현재 서버 기록 비교', exact: true }).click(); await expect(page.getByRole('heading', { name: '다른 작성자의 제목', exact: true })).toBeVisible(); await page.getByRole('button', { name: '작성값 유지·최신 기준 선택', exact: true }).click(); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await saved(page); expect((await json<ScheduleDetail>(page.request, `/api/schedule/${id}`)).current.content.title).toBe('보존할 내 제목'); });
