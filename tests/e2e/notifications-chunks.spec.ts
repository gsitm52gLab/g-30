import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { NotificationList, NotificationSync } from '@/server/notifications/contracts';
import { setup, schedule, login, json, journeys, ctx } from './support/g13';
journeys();
test('G13 UI-I actual more-than100 producer events drains bounded chunks only current self', async ({ page }, info) => { test.setTimeout(240000); const x = await setup(page); for (let i = 0; i < 103; i++)
    await schedule(page, x.taskId, { title: `Chunk source ${i}` }); const chunks: NotificationSync[] = []; page.on('response', r => { if (r.url().endsWith('/api/notifications/sync') && r.status() === 200)
    void r.json().then(v => chunks.push(v)); }); await login(page, 'luna@example.test'); await expect.poll(async () => (await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items.filter(n => n.title.startsWith('Chunk source ')).length, { timeout: 60000 }).toBe(103); expect(chunks.some(c => c.hasMore)).toBe(true); expect(chunks.some(c => !c.hasMore)).toBe(true); for (const c of chunks)
    expect(c.delivered + c.reused + c.suppressed + c.failed).toBeLessThanOrEqual(100); const before = await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByLabel('내 앱 알림')).toContainText(`안 읽음 ${before.unread}건`); expect((await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items.map(n => n.id).sort()).toEqual(before.items.map(n => n.id).sort()); await writeFile(info.outputPath('sync-chunks.json'), JSON.stringify(chunks)); });
