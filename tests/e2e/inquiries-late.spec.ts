import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ctx, api, login, create, open, tracing, get, origin } from '../fixtures/inquiries';
tracing();
for (const kind of ['message'] as ('message' | 'upload')[])
    test(`I09-08 late successful ${kind} after actual revocation cannot restore protected state`, async ({ page }, info) => { test.setTimeout(60000); const brand = await api('team@example.test'), admin = await api(); let release = () => { }; const gate = new Promise<void>(r => { release = r; }); try {
        const id = await create(brand, '철회 후 늦은 응답 ' + kind);
        await login(page, 'team@example.test');
        await open(page, id);
        let held = false, body: unknown = null;
        const url = kind === 'message' ? `**/api/inquiries/${id}` : `**/api/inquiries/${id}/files?visibility=public`;
        await page.route(url, async (route) => { if (route.request().method() === 'POST') {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            body = await response.json();
            held = true;
            await gate;
            await route.fulfill({ response });
            return;
        } await route.continue(); });
        if (kind === 'message') {
            await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('LATE-RESPONSE-SECRET');
            await page.getByRole('button', { name: '메시지 보내기', exact: true }).click();
        }
        else
            await page.getByLabel('대화 파일 추가', { exact: true }).setInputFiles({ name: 'LATE-UPLOAD-SECRET.csv', mimeType: 'text/csv', buffer: Buffer.from('kind,value\nLATE,1\n') });
        await expect.poll(() => held).toBe(true);
        const members = await get<{
            members: {
                id: string;
                revision: number;
                data: {
                    userId: string;
                };
            }[];
        }>(admin, `/api/contexts/${ctx}/members`), member = members.members.find(m => m.data.userId === 'user-team')!;
        const csrf = await (await admin.get('/api/auth/csrf')).json();
        expect((await admin.patch(`/api/contexts/${ctx}/members/${member.id}`, { headers: { Origin: origin(), 'X-CSRF-Token': csrf.csrfToken }, data: { expectedRevision: member.revision, status: 'suspended' } })).status()).toBe(200);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.locator('main').getByRole('alert')).toContainText('보호된 대화와 작성 내용을 지웠습니다');
        await page.evaluate(() => { const w = window as unknown as {
            lateLeaks: string[];
        }; w.lateLeaks = []; new MutationObserver(() => { const text = document.querySelector('main')?.textContent ?? ''; if (text.includes('서버 기록 성공') || text.includes('LATE-RESPONSE-SECRET') || text.includes('LATE-UPLOAD-SECRET'))
            w.lateLeaks.push(text); }).observe(document.querySelector('main')!, { childList: true, subtree: true, characterData: true }); });
        const delivered = page.waitForResponse(r => r.request().method() === 'POST' && (kind === 'message' ? new URL(r.url()).pathname === `/api/inquiries/${id}` : r.url().includes(`/api/inquiries/${id}/files`)));
        release();
        await delivered;
        await page.waitForTimeout(300);
        const observed = await page.evaluate(() => ({ leaks: (window as unknown as {
                lateLeaks: string[];
            }).lateLeaks, recovery: Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:inquiry:')).map(k => sessionStorage.getItem(k)), text: document.querySelector('main')?.textContent }));
        await writeFile(info.outputPath('held-success-and-after-clear.json'), JSON.stringify({ kind, body, observed }, null, 2));
        expect(observed.leaks).toEqual([]);
        expect(observed.recovery).toEqual([]);
        await expect(page.getByRole('region', { name: '문의 작성', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '비공개 초안 만들기', exact: true })).toHaveCount(0);
    }
    finally {
        release();
        await brand.dispose();
        await admin.dispose();
    } });
