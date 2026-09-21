import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ImportPreview } from '@/server/imports/contracts';
import { login } from './verify-evidence-ui-fixtures';
/** Called only by the private HTTP runner against its owned synthetic server. */
export async function namespaceBrowser(origin: string, contextId: string, report: string, artifacts: string[], check: (id: string, ok: unknown, requirements: string[]) => void) {
    const browser = await chromium.launch();
    try {
        for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
            const context = await browser.newContext({ baseURL: origin, viewport }), page = await context.newPage();
            const transcript: { url: string; status: number; body: unknown }[] = [], pending: Promise<void>[] = [];
            page.on('response', response => { if (/\/api\/imports\/(source|preview|apply|batches)/.test(response.url())) pending.push((async () => { transcript.push({ url: response.url(), status: response.status(), body: await response.json() }); })()); });
            await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
            try {
                await login(page.request, 'luna@example.test');
                await page.goto(`/products/import?context=${contextId}`);
                for (const fixture of ['standard', 'formula-cached', 'numeric-identifier']) {
                    const bytes = readFileSync(`tests/fixtures/imports-${fixture}-prefixed.xlsx`);
                    const reset = page.getByRole('button', { name: '다른 원본 가져오기', exact: true });
                    if (await reset.count()) await reset.click();
                    await page.getByLabel('상품 Excel 원본', { exact: true }).setInputFiles({ name: `${fixture}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
                    await page.getByRole('button', { name: '원본 읽기 · 다시 시도', exact: true }).click();
                    await expect(page.getByRole('status')).toContainText('원본을 읽었습니다.');
                    const sheets = page.getByRole('combobox', { name: '가져올 공개 시트', exact: true });
                    await sheets.selectOption((await sheets.locator('option').filter({ hasText: 'Products' }).getAttribute('value'))!);
                    await page.getByRole('spinbutton', { name: '머리글 행 번호', exact: true }).fill('3');
                    await page.getByRole('button', { name: '선택한 머리글의 표준 키로 매핑 채우기', exact: true }).click();
                    const previewButton = page.getByRole('button', { name: '전체 미리보기 만들기 · 다시 검증', exact: true });
                    await expect(previewButton).toBeEnabled();
                    const [previewResponse] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/imports/preview') && r.request().method() === 'POST'), previewButton.click()]);
                    const preview = await previewResponse.json() as ImportPreview;
                    check(`${name} ${fixture}: actual UI source and header mapping keep original hash`, previewResponse.status() === 201 && preview.sourceHash === createHash('sha256').update(bytes).digest('hex'), ['G07-V02', 'AC-07-03']);
                    const apply = page.getByRole('button', { name: '확인한 모든 행 반영', exact: true });
                    if (fixture === 'standard') {
                        await expect(apply).toBeEnabled();
                        await expect(page.getByRole('article', { name: '원본 4행', exact: true })).toContainText('0000000000003');
                        await expect(page.getByRole('article', { name: '원본 5행', exact: true })).toContainText('12345678901234567890.123456');
                        await apply.click();
                        await expect(page.getByRole('region', { name: '가져오기 반영 결과', exact: true })).toContainText('반영 행 3개');
                        await page.reload();
                        await expect(page.getByRole('heading', { name: '가져오기 완료 · 저장된 결과', exact: true })).toBeVisible();
                        check(`${name}: exact original standard UI applies and reloads durable result`, true, ['G07-V02', 'AC-07-03']);
                    } else {
                        await expect(apply).toBeDisabled();
                        await expect(page.getByRole('region', { name: '전체 검증 미리보기', exact: true })).toContainText('오류');
                        check(`${name} ${fixture}: UI blocks invalid apply`, !preview.canApply && preview.errorRows > 0, ['G07-V02', 'AC-07-03']);
                    }
                    check(`${name} ${fixture}: no horizontal viewport overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), ['G07-V02']);
                    const screenshot = `${report}.${name}-${fixture}.png`; await page.screenshot({ path: screenshot, fullPage: true }); artifacts.push(screenshot);
                }
            } finally {
                const collected = await Promise.allSettled(pending);
                const collectionFailures = collected.filter(r => r.status === 'rejected');
                if (collectionFailures.length) transcript.push({ url: 'response-collection-failure', status: 0, body: collectionFailures.map(r => String(r.reason)) });
                const trace = `${report}.${name}.trace.zip`, dom = `${report}.${name}.html`, responses = `${report}.${name}.responses.json`;
                await context.tracing.stop({ path: trace }); writeFileSync(dom, await page.content()); writeFileSync(responses, JSON.stringify(transcript, null, 2)); artifacts.push(trace, dom, responses);
                await context.close();
            }
        }
    } finally { await browser.close(); }
}
