import { completionCampaign } from '../fixtures/completion-campaign';
import { CampaignService } from '@/server/campaigns/service';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordRepository } from '@/domain/records';
import { StoreError } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { HomeService, homeQuery } from '@/server/home/service';
import { InquiryService } from '@/server/inquiries/service';
import { navigationMenus } from '@/features/home/navigation';
import { createHomeFixtures, A, B } from '../../scripts/verify-home-fixtures';
import { policyFixture, tokenFor, NOW, marker } from '../fixtures/policy';
const actors = { admin: tokenFor('user-admin'), brand: tokenFor('user-luna'), gsg: tokenFor('user-gsg'), team: tokenFor('user-team'), co: tokenFor('user-co') };
for (const mode of ['mock', 'sqlite'] as const) describe(`${mode} G03 home`, () => {
  let repo: RecordRepository;
  afterEach(async () => { await repo?.close(); });
  async function setup() { if (mode === 'mock') repo = createMockRepository(() => NOW); else { const db = openDatabase(':memory:', true); migrate(db); repo = createSqliteRepository(db, () => NOW); } const identity = await policyFixture(repo); return { identity, home: new HomeService(identity) }; }
  it('AC03-01 exact role counts, current assignments, current needs and five questions/four answers', async () => {
    const { identity, home } = await setup(), f = await createHomeFixtures(identity, actors, 'G03');
    const staff = await home.read(actors.gsg, { scope: 'context', context: A }), brand = await home.read(actors.brand, { scope: 'context', context: A });
    expect(staff.counts).toMatchObject({ unresolved: 1, today: 1, near: 1, overdue: 1, externalChecks: 1, newSubmissions: 1, handoffChecks: 1, corrections: 1, confirmation: 2, unreadNotices: 1 });
    expect(brand.counts).toMatchObject({ unresolved: 1, today: 1, near: 1, overdue: 1, externalChecks: 0, newSubmissions: 0 });
    const task = staff.tasks.find(t => t.id === f.todayTask)!;
    expect(brand.tasks.find(t => t.id === f.todayTask)).toMatchObject({ owner: task.owner, assignees: task.assignees, deadline: task.deadline, remaining: 1, status: 'partial' });
    expect(staff.tasks.find(t => t.id === f.full)?.remaining).toBe(0);
    expect(staff.questions[0]).toMatchObject({ id: f.questionId, state: 'external_waiting', url: `/inquiries/${f.conversationId}?context=${A}#question-${f.questionId}` });
    expect(staff.dates.filter(d => d.bucket === 'overdue' && d.pending && !d.external).map(d => d.taskId)).toEqual([f.overdue]);
    const inquiry = new InquiryService(identity), d = await inquiry.detail(actors.gsg, f.conversationId); if (d.phase !== 'active') throw Error();
    const q = d.questions.find(q => q.id === f.questionId)!;
    await inquiry.command(actors.gsg, d.id, { command: 'answer', questionId: q.id, expectedQuestionRevision: q.revision, content: { clientMessageId: crypto.randomUUID(), body: '다섯 번째 답변', fileVersionIds: [] }, idempotencyKey: crypto.randomUUID() });
    expect((await home.read(actors.gsg, { scope: 'context', context: A })).counts).toMatchObject({ unresolved: 0, externalChecks: 0 });
  });
  it('AC03-02 scope filters, minimal DTO privacy, peer/foreign denial, current revocation and no read side effects', async () => {
    const { identity, home } = await setup(), f = await createHomeFixtures(identity, actors, 'G03_PRIVATE_FOREIGN');
    expect((await home.read(actors.gsg, {})).scope).toBe('all'); expect((await home.read(actors.brand, {})).scope).toBe('mine');
    const before = await Promise.all(['audit', 'domainEvent', 'inquiryRead', 'noticeRead'].map(k => repo.list(k as 'audit')));
    const own = await home.read(actors.co, { scope: 'mine' }); expect(own.tasks.some(t => t.id === f.todayTask)).toBe(true); expect(own.tasks.some(t => t.id === f.foreign)).toBe(false);
    expect((await home.read(actors.team, { scope: 'mine' })).tasks).toEqual([]);
    const peer = await home.read(actors.team, { scope: 'context', context: A }); expect(peer.tasks.some(t => t.id === f.todayTask)).toBe(true); expect(peer.questions).toEqual([]);
    expect(JSON.stringify(peer)).not.toContain('다른 리테일러 비공개표식'); expect(JSON.stringify(peer)).not.toContain(marker); expect(JSON.stringify(peer)).not.toMatch(/internalSupply|internalMemo|password|digest|tokenHash/);
    await expect(home.read(actors.team, { scope: 'all', context: B })).rejects.toMatchObject({ status: 404 });
    expect((await home.read(actors.brand, { scope: 'all' })).tasks.some(t => t.id === f.foreign)).toBe(true);
    expect(await Promise.all(['audit', 'domainEvent', 'inquiryRead', 'noticeRead'].map(k => repo.list(k as 'audit')))).toEqual(before);
    await repo.transaction(async s => { const m = (await s.list('membership', A)).find(m => m.data.userId === 'user-team')!; await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' }); });
    await expect(home.read(actors.team, { scope: 'context', context: A })).rejects.toMatchObject({ status: 404 });
    expect((await home.read(actors.team, { scope: 'all' })).tasks).toEqual([]);
  });
  it('campaign overview links the exact published detail and hides draft existence from brand', async () => {
    const { identity, home } = await setup(), fixture = await completionCampaign(identity);
    const campaigns = new CampaignService(identity);
    await campaigns.command(actors.admin, { command: 'save', contextId: A, taskId: fixture.taskId, campaignId: null, expectedRevision: 0, idempotencyKey: crypto.randomUUID(), draft: { ...fixture.draft, title: 'G03_HIDDEN_CAMPAIGN_DRAFT' } });
    const brand = await home.read(actors.brand, {scope: 'context', context: A});
    expect(brand.campaigns).toHaveLength(1); expect(JSON.stringify(brand)).not.toContain('G03_HIDDEN_CAMPAIGN_DRAFT');
    const item = brand.campaigns[0], url = new URL(item.url, 'https://example.test');
    expect(url.searchParams.get('campaign')).toBe(fixture.campaignId); expect(url.searchParams.get('context')).toBe(A);
    const detail = await campaigns.detail(actors.brand, url.searchParams.get('campaign')!);
    expect(detail.id).toBe(item.id); expect(detail.taskId).toBe(fixture.taskId);
    expect((await home.read(actors.admin, {scope:'context',context:A})).campaigns).toHaveLength(2);
  });
  it('storage failures propagate instead of false empty successful responses and clean retries work', async () => {
    const { identity, home } = await setup(); const normal = await home.read(actors.gsg, { scope: 'context', context: A });
    const broken = new HomeService(new IdentityService({ ...repo, transaction: async () => { throw new StoreError('STORAGE_UNAVAILABLE'); } }, identity.clock));
    await expect(broken.read(actors.gsg, {})).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(await home.read(actors.gsg, { scope: 'context', context: A })).toEqual(normal);
  });
});
it('rejects invalid/duplicate scopes and navigation contains standalone products, campaigns, legal pre-review with GSG-only settings', () => {
  for (const q of ['scope=invalid', 'context=a&context=b', 'scope=all&unknown=secret']) expect(() => homeQuery(new URLSearchParams(q))).toThrow();
  expect(navigationMenus('brand').map(m => m[0])).toEqual(expect.arrayContaining(['/products', '/campaigns', '/ai-input', '/inquiries', '/materials']));
  expect(navigationMenus('brand').find(m=>m[1]==='약기법 사전검토')?.[0]).toBe('/ai-input');
  expect(navigationMenus('gsg').find(m=>m[1]==='약기법 사전검토')?.[0]).toBe('/ai-review');
  expect(navigationMenus('brand').filter(m=>m[0]==='/ai-input')).toHaveLength(1);
  expect(navigationMenus('brand').some(m=>m[0]==='/ai-review')).toBe(false);
  expect(navigationMenus('brand').some(m => m[0] === '/contexts')).toBe(false); expect(navigationMenus(null).some(m => m[0] === '/contexts')).toBe(false); expect(navigationMenus('gsg').some(m => m[0] === '/contexts')).toBe(true);
});
