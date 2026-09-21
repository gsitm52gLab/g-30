import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import type { NotificationList } from '@/server/notifications/contracts';
import { setup, login, json, journeys, ctx } from './support/g13';
journeys();
test('G13 UI-J SQLite actual delivery rollback failure retry UI preserves one notification', async ({ page }, info) => { test.skip(process.env.E2E_DATA_SOURCE !== 'sqlite', 'Stored delivery fault injected only into this owned SQLite fixture; mock HTTP fault is separately tested.'); const x = await setup(page), dbPath = process.env.DATABASE_FILE!; for (const suffix of ['', '-wal', '-shm'])
    if (existsSync(dbPath + suffix))
        copyFileSync(dbPath + suffix, info.outputPath('before-injection.db' + suffix)); const db = new Database(dbPath, { fileMustExist: true }); try {
    db.exec("CREATE TRIGGER g13_ui_fault BEFORE INSERT ON records WHEN NEW.kind='notification' AND json_extract(NEW.data,'recipientId')='user-luna' BEGIN SELECT RAISE(ABORT,'G13 owned synthetic fault'); END;");
    await login(page, 'luna@example.test');
    await page.goto(`/notifications?context=${ctx}`);
    await expect(page.getByRole('heading', { name: '앱 알림 저장 실패', exact: true })).toBeVisible();
    const failed = await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`);
    expect(failed.failures.length).toBeGreaterThan(0);
    expect(failed.items.filter(i => i.title === x.content.title)).toHaveLength(0);
    db.exec('DROP TRIGGER g13_ui_fault');
    await page.getByRole('button', { name: '실패한 알림 다시 저장', exact: true }).first().click();
    await expect.poll(async () => (await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items.filter(i => i.title === x.content.title).length).toBe(1);
    await page.getByRole('button', { name: '알림 다시 확인', exact: true }).click();
    expect((await json<NotificationList>(page.request, `/api/notifications?context=${ctx}`)).items.filter(i => i.title === x.content.title)).toHaveLength(1);
}
finally {
    db.exec('DROP TRIGGER IF EXISTS g13_ui_fault');
    db.close();
} });
