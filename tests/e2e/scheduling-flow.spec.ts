import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { ScheduleDetail, ScheduleList } from '@/server/scheduling/contracts';
import { ctx, setup, fillNew, saved, find, json, open, login, journeys } from './support/g13';
journeys();
test('G13 UI-A actual structured date sources conflict history action states and brand projection', async ({ page }, info) => {
    test.setTimeout(120000);
    const x = await setup(page), title = '날짜 충돌을 보존하는 Shipping observation '.repeat(3).trim();
    await fillNew(page, x.taskId, title);
    await page.getByRole('checkbox', { name: '날짜 미정', exact: true }).uncheck();
    await page.getByLabel('날짜', { exact: true }).fill('2099-10-02');
    await page.getByRole('combobox', { name: '확정 수준', exact: true }).selectOption('expected');
    await page.getByRole('textbox', { name: '원문 날짜·확인 내용', exact: true }).fill('  原文 10月2日 예정  ');
    for (let i = 0; i < 2; i++) {
        await page.getByRole('button', { name: '출처 원문 추가', exact: true }).click();
        const g = page.getByRole('group', { name: `출처 원문 ${i + 1}`, exact: true });
        await g.getByRole('textbox', { name: '원문', exact: true }).fill(i ? '10월 3일 예정' : '10월 2일 예정');
        await g.getByRole('textbox', { name: '출처·확인 상대', exact: true }).fill(i ? '메일 B' : '문서 A');
    }
    await page.getByRole('button', { name: '원문 충돌 추가', exact: true }).click();
    const conflict = page.getByRole('group', { name: '일정 충돌 1', exact: true });
    await conflict.getByRole('checkbox').nth(0).check();
    await conflict.getByRole('checkbox').nth(1).check();
    await page.getByRole('button', { name: '일정 저장', exact: true }).click();
    await saved(page);
    const id = await find(page, title), d = await json<ScheduleDetail>(page.request, `/api/schedule/${id}`);
    expect(d.revision).toBe(2);
    expect(d.current.content.deadline.raw).toBe('原文 10月2日 예정');
    expect(d.current.content.deadline.value).toBe('2099-10-02');
    expect(d.calendar.actionOwners.map(a => a.id)).toEqual(['user-luna']);
    expect(d.calendar.reminder).toEqual({ eligible: false, reason: 'other_recipient' });
    await expect(page.getByText('원문 일정이 충돌합니다. 출처와 해소 근거를 확인해 주세요.', { exact: true }).first()).toBeVisible();
    const widths = await page.locator('main').evaluate(e => ({ scroll: document.documentElement.scrollWidth, main: e.getBoundingClientRect().toJSON(), controls: [...e.querySelectorAll('input,select,textarea,button')].filter(x => x.getClientRects().length).map(x => x.getBoundingClientRect().toJSON()) }));
    expect(widths.scroll).toBeLessThanOrEqual(page.viewportSize()!.width);
    for (const r of widths.controls) {
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    await writeFile(info.outputPath('configured-viewport-geometry.json'), JSON.stringify({ configured: page.viewportSize(), ...widths }));
    await open(page, id);
    await page.getByRole('group', { name: '일정 충돌 1', exact: true }).getByRole('combobox', { name: '충돌 확인 상태', exact: true }).selectOption('resolved');
    await page.getByRole('textbox', { name: '해소 근거·남은 확인', exact: true }).fill('거래처가 2일 예정으로 회신');
    await page.getByRole('button', { name: '일정 저장', exact: true }).click();
    await saved(page);
    await page.getByRole('button', { name: '이 일정 행동 종료', exact: true }).click();
    await saved(page);
    await expect(page.getByRole('button', { name: '이 일정 다시 열기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이 일정 다시 열기', exact: true }).click();
    await saved(page);
    await page.getByRole('button', { name: '이 일정 취소', exact: true }).click();
    await saved(page);
    const end = await json<ScheduleDetail>(page.request, `/api/schedule/${id}`);
    expect(end.versions).toHaveLength(5);
    expect(end.current.state).toBe('cancelled');
    expect((await json<{
        task: {
            data: {
                status: string;
            };
        };
    }>(page.request, `/api/tasks/${x.taskId}?context=${ctx}`)).task.data.status).toBe('requested');
    await login(page, 'luna@example.test');
    await open(page, id);
    await expect(page.getByRole('button', { name: '일정 저장', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '일정 변경 이력', exact: true })).toBeVisible();
    const brand = await json<ScheduleList>(page.request, `/api/schedule?context=${ctx}`);
    expect(brand.capabilities.create).toBe(false);
    expect(brand.actors).toEqual([]);
});
test('G13 UI-B explicit timezone offset DST validation and responsible policy switch', async ({ page }) => { test.setTimeout(90000); const x = await setup(page); await fillNew(page, x.taskId, '시각·책임 검증'); await page.getByRole('checkbox', { name: '날짜 미정', exact: true }).uncheck(); await page.getByRole('combobox', { name: '날짜 정밀도', exact: true }).selectOption('datetime'); await page.getByRole('textbox', { name: 'IANA 시간대', exact: true }).fill('America/New_York'); await page.getByLabel('현지 날짜와 시각', { exact: true }).fill('2026-03-08T02:30'); await page.getByRole('textbox', { name: '원문의 UTC 오프셋', exact: true }).fill('-05:00'); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: '존재하는 시각' })).toBeVisible(); await page.getByLabel('현지 날짜와 시각', { exact: true }).fill('2026-11-01T01:30'); await page.getByRole('textbox', { name: '원문의 UTC 오프셋', exact: true }).fill('-04:00'); await page.getByRole('combobox', { name: '일정 종류', exact: true }).selectOption('submission'); await expect(page.getByRole('combobox', { name: '기한 확인 책임자', exact: true })).toBeVisible(); await page.getByRole('combobox', { name: '기한 확인 책임자', exact: true }).selectOption('user-gsg'); await page.getByRole('combobox', { name: '확정 수준', exact: true }).selectOption('confirmed'); await page.getByRole('button', { name: '일정 저장', exact: true }).click(); await saved(page); const id = await find(page, '시각·책임 검증'), d = await json<ScheduleDetail>(page.request, `/api/schedule/${id}`); expect(d.current.content.deadline.value).toBe('2026-11-01T05:30:00.000Z'); expect(d.calendar.confirmationParty.id).toBe('user-gsg'); expect(d.calendar.actionOwners.map(a => a.id).sort()).toEqual(['user-co', 'user-luna']); expect(d.calendar.recipientPolicy).toBe('task_assignees'); await page.getByRole('button', { name: '목록 보기', exact: true }).click(); await expect(page.getByRole('heading', { name: '일정 목록', exact: true })).toBeVisible(); });
