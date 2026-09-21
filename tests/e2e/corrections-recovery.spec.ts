import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seed, open, opinionUI, batchUI, button, field, settled, getWorkspace, mutate, capture, retain, recordJSON } from '../fixtures/corrections-ui';
test.afterEach(async ({ page }, info) => retain(page, info));
test('G10 UI-D actual lost response same key and committed POST failed GET reread only', async ({ page }, info) => { test.setTimeout(100000); const { id, v1 } = await seed(page); await open(page, id); let dropped = false; const sent: unknown[] = []; await page.route('**/api/corrections', async (route) => { if (route.request().method() === 'POST' && !dropped) {
    dropped = true;
    sent.push(route.request().postDataJSON());
    const r = await route.fetch();
    expect(r.status()).toBe(200);
    await route.abort('failed');
}
else {
    if (route.request().method() === 'POST')
        sent.push(route.request().postDataJSON());
    await route.continue();
} }); await button(page, '내부 의견').click(); await button(page, '새 내부 의견').click(); await field(page, '검토자').fill('복구 검토자'); await field(page, '원문 출처').fill('응답 유실 원문'); await field(page, '의견 원문 · 내부 전용').fill('입력 유지 원문'); await button(page, '의견 버전 저장').click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(field(page, '의견 원문 · 내부 전용')).toHaveValue('입력 유지 원문'); await page.reload(); await button(page, '작성값 복구하기').click(); await button(page, '같은 요청 다시 확인').click(); await settled(page); expect(sent).toHaveLength(2); expect(sent[0]).toEqual(sent[1]); expect((await getWorkspace(page, id)).staff!.opinions).toHaveLength(1); await page.unroute('**/api/corrections'); const o = (await getWorkspace(page, id)).staff!.opinions[0]; await batchUI(page, v1, [o.currentVersionId!], 1); let failGet = false, publishCount = 0; await page.route('**/api/corrections', async (route) => { const body = route.request().postDataJSON(); if (body.command === 'publish') {
    publishCount++;
    const r = await route.fetch();
    expect(r.status()).toBe(200);
    failGet = true;
    await route.fulfill({ response: r });
}
else
    await route.continue(); }); await page.route(`**/api/corrections?taskId=${id}`, async (route) => { if (failGet) {
    failGet = false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_GET_FAILURE', message: '합성 확정 후 조회 실패' } }) });
}
else
    await route.continue(); }); await button(page, '이 묶음 공개하기').click(); await expect(page.getByRole('region', { name: '명령 복구' })).toContainText('서버가 확정한 ID'); await expect(page.getByRole('alert').filter({hasText:'합성 확정 후 조회 실패'})).toContainText('합성 확정 후 조회 실패'); await page.reload(); await button(page, '작성값 복구하기').click(); await button(page, '확정 기록 다시 조회').click(); await settled(page); expect(publishCount).toBe(1); expect((await getWorkspace(page, id)).batches).toHaveLength(1); await capture(page, info, 'receipt-reread'); await recordJSON(info, 'same-intent', { sent, publishCount, workspace: await getWorkspace(page, id) }); });
test('G10 UI-E actual CAS conflict keeps local draft explicit comparison and latest revision', async ({ page }, info) => { test.setTimeout(100000); const { id, v1 } = await seed(page); await open(page, id); const o = await opinionUI(page, v1); await batchUI(page, v1, [o.currentVersionId!], 1); const w = await getWorkspace(page, id), d = w.staff!.drafts[0]; await field(page, '공개 제목').fill('내가 유지할 입력'); const r = await mutate(page.request, '/api/corrections', { taskId: id, command: 'save_draft', draftId: d.id, expectedRevision: d.revision, draft: { ...d.draft, title: '다른 작성자의 최신 제목' }, idempotencyKey: randomUUID() }); expect(r.status()).toBe(200); await button(page, '공개 초안 저장').click(); await expect(page.getByRole('region', { name: '명령 복구' })).toContainText('동시 변경 확인'); await expect(field(page, '공개 제목')).toHaveValue('내가 유지할 입력'); await button(page, '서버 최신 기록 비교').click(); await page.getByText('서버에 저장된 공개 초안 비교', { exact: true }).click(); await expect(page.getByRole('region', { name: '명령 복구' })).toContainText('다른 작성자의 최신 제목'); await button(page, '입력 유지 · 최신 기준 선택').click(); await button(page, '공개 초안 저장').click(); await settled(page); expect((await getWorkspace(page, id)).staff!.drafts[0].draft.title).toBe('내가 유지할 입력'); await capture(page, info, 'cas-preserved-input'); });
