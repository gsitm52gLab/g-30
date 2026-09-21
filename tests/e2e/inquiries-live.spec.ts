import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ctx, api, login, create, detail, open, tracing, screenshot, command, content, get, origin } from '../fixtures/inquiries';
tracing();
test('I09-04 actual SSE, disconnect catchup, public/private separation and current revocation purge', async ({ page }, info) => { test.setTimeout(90000); const brand = await api('team@example.test'), admin = await api(); try {
    const id = await create(brand, '실시간 문의 ' + info.project.name);
    await login(page, 'team@example.test');
    await open(page, id);
    await expect(page.getByRole('status').filter({ hasText: '실시간 연결됨' })).toBeVisible();
    await command(admin, id, { command: 'message', kind: 'comment', questionId: null, content: content('상대방 실제 실시간 메시지') });
    await expect(page.getByRole('region', { name: '공개 대화', exact: true })).toContainText('상대방 실제 실시간 메시지');
    const before = await detail(brand, id);
    await command(admin, id, { command: 'internal_note', questionId: null, content: content('G09-UI-INTERNAL-PRIVATE-CANARY') });
    await expect(page.getByText('G09-UI-INTERNAL-PRIVATE-CANARY', { exact: true })).toHaveCount(0);
    const after = await detail(brand, id);
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.messages).toEqual(before.messages);
    await page.context().setOffline(true);
    await command(admin, id, { command: 'message', kind: 'comment', questionId: null, content: content('오프라인 중 누락 메시지 1') });
    await command(admin, id, { command: 'message', kind: 'comment', questionId: null, content: content('오프라인 중 누락 메시지 2') });
    await page.context().setOffline(false);
    await expect(page.getByRole('region', { name: '공개 대화', exact: true })).toContainText('오프라인 중 누락 메시지 2', { timeout: 15000 });
    await expect(page.locator('[data-message-id]')).toHaveCount(4);
    expect(new Set(await page.locator('[data-message-id]').evaluateAll(els => els.map(e => e.getAttribute('data-message-id')))).size).toBe(4);
    await page.getByRole('textbox', { name: '메시지 내용', exact: true }).fill('권한 철회 시 지워질 로컬 입력');
    await page.getByLabel('대화 파일 추가', { exact: true }).setInputFiles({ name: 'G09-READY-PRIVATE.csv', mimeType: 'text/csv', buffer: Buffer.from('kind,value\nREADY,1\n') });
    await expect(page.getByText('업로드 완료', { exact: false })).toBeVisible();
    await screenshot(page, info, 'live-catchup');
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
    const response = await admin.patch(`/api/contexts/${ctx}/members/${member.id}`, { headers: { Origin: origin(), 'X-CSRF-Token': csrf.csrfToken }, data: { expectedRevision: member.revision, status: 'suspended' } });
    expect(response.status()).toBe(200);
    await expect(page.locator('main').getByRole('alert')).toContainText('보호된 대화와 작성 내용을 지웠습니다', { timeout: 15000 });
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await expect(page.getByText('G09-READY-PRIVATE.csv', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '메시지 내용', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('gs-hale:inquiry:')).length)).toBe(0);
    expect((await brand.get(`/api/inquiries/${id}`)).status()).toBe(404);
    await writeFile(info.outputPath('public-before-after-private.json'), JSON.stringify({ before, after, retained: (await detail(admin, id)).messages.length }));
    await screenshot(page, info, 'revoked-cleared');
}
finally {
    await brand.dispose();
    await admin.dispose();
} });
