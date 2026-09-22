import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecordRepository, UnitOfWork } from '@/domain/records';
import type { IdentityService } from '@/server/auth/service';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { TaskService } from '@/server/tasks/service';
import { NoticeService } from '@/server/notices/service';
import { InquiryService } from '@/server/inquiries/service';
import { CorrectionService } from '@/server/corrections/service';
import { CompletionService } from '@/server/completion/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankNotice } from '@/domain/notices/types';
import { taskSchedules, campaignSchedules, inquirySchedules } from '@/server/scheduling/sources';
import { sourceReminderDecision } from '@/server/notifications/eligibility';
import { notificationEventSource } from '@/server/notifications/sources';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { admin, brand, contextId, completionSubmission, completionInquiry } from '../fixtures/completion';
import { completionCampaign, campaignMarker } from '../fixtures/completion-campaign';
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G13 actual producer source adapters`, () => {
        let repo: RecordRepository, identity: IdentityService, dir: string, taskId: string;
        const gsg = tokenFor('user-gsg'), co = tokenFor('user-co'), team = tokenFor('user-team');
        async function setup() {
            repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })();
            identity = await policyFixture(repo);
            dir = await mkdtemp(join(tmpdir(), 'g13-source-'));
            const c = blankContent();
            c.title = 'G13 실제 공개 일정';
            c.description = '공개 요청';
            c.internalOriginal = 'PRIVATE_G13_ORIGINAL';
            c.internalMemo = 'PRIVATE_G13_MEMO';
            c.deadline = { ...c.deadline, value: '2026-09-21', certainty: 'requested', responsibleUserId: 'user-gsg', source: '공개 요청서', sourceVersion: 'v1' };
            c.requirements = [{ ...blankRequirement('answer'), label: '답변' }, { ...blankRequirement('missing', 'short_text'), label: '아직 미제출' }];
            c.milestones = [{ id: 'internal-date', kind: 'review', deadline: { ...c.deadline, raw: 'PRIVATE_G13_DATE' }, counterpart: 'PRIVATE_G13_COUNTERPART', visibility: 'internal' }, { id: 'public-date', kind: 'application', deadline: c.deadline, counterpart: '공개 기관', visibility: 'public' }];
            const tasks = new TaskService(identity);
            taskId = (await tasks.create(admin, { category: 'spot', content: c, targets: [{ contextId, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: ['product-serum'] }], idempotencyKey: randomUUID() })).ids[0];
            await tasks.command(admin, taskId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
        }
        async function read<T>(token: string, fn: (s: UnitOfWork, p: Awaited<ReturnType<IdentityService['principal']>>) => T | Promise<T>) { return repo.transaction(async (s) => (await fn(s, (await identity.principal(s, token))))); }
        async function events(type: string, target = taskId) { return (await repo.list('domainEvent')).filter(e => e.data.eventType === type && e.data.targetId === target); }
        async function event(token: string, type: string, target = taskId) { const rows = await events(type, target); expect(rows.length).toBeGreaterThan(0); return read(token, async (s, p) => (await notificationEventSource(s, p, rows.at(-1)!.id, () => NOW))); }
        async function schedules(token = brand, id = taskId) { return read(token, async (s, p) => (await taskSchedules(s, p, id, () => NOW))); }
        async function complete(id = taskId) { const c = new CompletionService(identity), w = await c.workspace(admin, id); return (await c.command(admin, { command: 'complete', taskId: id, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() })).ids[0]; }
        afterEach(async () => { (await repo?.close()); if (dir)
            await rm(dir, { recursive: true, force: true }); });
        it('S13-01 actual G04 public request/current recipients, private milestone exclusion, unknown fields never spread', async () => {
            await setup();
            const published = (await events('TASK_PUBLISHED'))[0], raw = await repo.get('domainEvent', published.id);
            await repo.transaction(async (s) => { const t = (await s.get('task', taskId))!; (await s.update('task', t.id, t.revision, { ...t.data, privateExtra: 'PRIVATE_G13_EXT' } as typeof t.data)); });
            const a = await event(brand, 'TASK_PUBLISHED'), b = await event(co, 'TASK_PUBLISHED'), non = await event(team, 'TASK_PUBLISHED');
            expect(a).toMatchObject({ disposition: 'eligible', recipientId: 'user-luna', certainty: 'requested', source: { versionId: published.data.sourceVersionId } });
            expect(b).toMatchObject({ disposition: 'eligible', recipientId: 'user-co' });
            expect(non.disposition).toBe('other_recipient');
            const rows = await schedules();
            expect(rows).toHaveLength(2);
            expect(await schedules(admin)).toHaveLength(3);
            expect(rows[0].need).toMatchObject({ remaining: 2, required: true });
            expect(sourceReminderDecision(rows[0], NOW)).toMatchObject({ eligible: true, calendar: { basis: 'tentative' } });
            expect(JSON.stringify([a, rows])).not.toContain('PRIVATE_G13');
            expect(await repo.get('domainEvent', published.id)).toEqual(raw);
        });
        it('S13-02 actual G05 partial submission routes to owner and updates current missing without consuming read/draft state', async () => {
            await setup();
            const before = await schedules();
            expect(before[0].need).toMatchObject({ remaining: 2 });
            const target = await completionSubmission(identity, dir, taskId), sub = await repo.get('submission', target.submissionId), draft = await repo.list('submissionDraft');
            expect(await event(gsg, 'TASK_SUBMITTED')).toMatchObject({ disposition: 'eligible', recipientId: 'user-gsg', source: { versionId: target.submissionId } });
            expect((await event(brand, 'TASK_SUBMITTED')).disposition).toBe('other_recipient');
            expect((await schedules())[0].need).toMatchObject({ remaining: 1, taskStatus: 'partial' });
            expect(await repo.get('submission', target.submissionId)).toEqual(sub);
            expect(await repo.list('submissionDraft')).toEqual(draft);
        });
        it('S13-03 current session/membership authority defeats previously captured principal and wrong context', async () => {
            await setup();
            const id = (await events('TASK_PUBLISHED'))[0].id;
            await expect(event(tokenFor('user-wave'), 'TASK_PUBLISHED')).rejects.toMatchObject({ status: 404 });
            const old = await read(brand, (_s, p) => p);
            await repo.transaction(async (s) => { const m = (await s.list('membership', contextId)).find(m => m.data.userId === 'user-luna')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect(repo.transaction(async (s) => (await notificationEventSource(s, old, id, () => NOW)))).rejects.toMatchObject({ status: 404 });
            await expect(schedules()).rejects.toMatchObject({ status: 404 });
            await repo.transaction(async (s) => { const row = (await s.get('session', old.session.id))!; (await s.update('session', row.id, row.revision, { ...row.data, revokedAt: NOW })); });
            await expect(repo.transaction(async (s) => (await notificationEventSource(s, old, id, () => NOW)))).rejects.toMatchObject({ status: 401 });
        });
        it('S13-04 actual G04 activity IDs are exact; legacy request-only event precision stays unavailable', async () => {
            await setup();
            const tasks = new TaskService(identity);
            for (const day of ['2026-09-22', '2026-09-23']) {
                const t = (await repo.get('task', taskId))!;
                await tasks.command(brand, taskId, { command: 'schedule', expectedRevision: t.revision, reason: '일정 조정 ' + day, deadline: { ...blankContent().deadline, value: day, responsibleUserId: 'user-luna' }, idempotencyKey: randomUUID() });
            }
            const e = await events('TASK_SCHEDULE_CHANGE_REQUESTED');
            expect(e).toHaveLength(2);
            for (const row of e) {
                const activity = (await repo.get('taskActivity', row.data.sourceVersionId!))!;
                expect(activity.data.kind).toBe('schedule');
                expect(await read(gsg, async (s, p) => (await notificationEventSource(s, p, row.id, () => NOW)))).toMatchObject({ disposition: 'eligible', sourcePrecision: 'exact', source: { versionId: activity.id } });
            }
            // Historical pre-G13 format fixture: retain unknown precision instead of picking either new activity.
            const legacy = await repo.transaction(async (s) => (await s.create('domainEvent', { id: randomUUID(), contextId, data: { ...e[0].data, sourceVersionId: (await s.get('task', taskId))!.data.currentRequestId! } })));
            expect(await read(gsg, async (s, p) => (await notificationEventSource(s, p, legacy.id, () => NOW)))).toMatchObject({ disposition: 'eligible', sourcePrecision: 'activity_unavailable', source: { versionId: legacy.data.sourceVersionId } });
        });
        it('S13-05 G08 draft0, exact published recipients/current AND historical audience, read state untouched', async () => {
            await setup();
            const notices = new NoticeService(identity), c = { ...blankNotice(), title: '실제 공지', body: '공개 본문', audience: { mode: 'selected' as const, userIds: ['user-luna'] } };
            const id = (await notices.create(admin, { contextId, content: c, idempotencyKey: randomUUID() })).ids[0];
            expect(await events('NOTICE_PUBLISHED', id)).toHaveLength(0);
            await notices.command(admin, id, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
            const old = (await events('NOTICE_PUBLISHED', id))[0], reads = await repo.list('noticeRead');
            expect((await event(brand, 'NOTICE_PUBLISHED', id)).disposition).toBe('eligible');
            await expect(event(co, 'NOTICE_PUBLISHED', id)).rejects.toMatchObject({ status: 404 });
            await notices.command(admin, id, { command: 'save', expectedRevision: 2, content: { ...c, audience: { mode: 'selected', userIds: ['user-co'] } }, idempotencyKey: randomUUID() });
            await notices.command(admin, id, { command: 'publish', expectedRevision: 3, idempotencyKey: randomUUID() });
            await expect(read(brand, async (s, p) => (await notificationEventSource(s, p, old.id, () => NOW)))).rejects.toMatchObject({ status: 404 });
            expect((await event(co, 'NOTICE_REVISED', id)).disposition).toBe('eligible');
            expect(await repo.list('noticeRead')).toEqual(reads);
        });
        it('S13-06 actual G09 private draft/internal note0; question→GSG, public answer→initiator, external date GSG-only', async () => {
            await setup();
            const inquiries = new InquiryService(identity), r = await completionInquiry(identity, taskId);
            expect((await event(gsg, 'INQUIRY_PUBLISH_FIRST', r.conversationId)).disposition).toBe('eligible');
            expect((await read(brand, async (s, p) => (await inquirySchedules(s, p, r.conversationId, () => NOW))))).toEqual([]);
            const rows = await read(gsg, async (s, p) => (await inquirySchedules(s, p, r.conversationId, () => NOW)));
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ recipientState: 'current_recipient', source: { versionId: null, itemKey: r.questionId }, deadline: { value: '2026-10-05', timezone: 'Asia/Tokyo' } });
            const before = (await repo.list('domainEvent')).length;
            await inquiries.command(admin, r.conversationId, { command: 'internal_note', questionId: r.questionId, content: { clientMessageId: randomUUID(), body: 'PRIVATE_G13_NOTE', fileVersionIds: [] }, idempotencyKey: randomUUID() });
            expect(await repo.list('domainEvent')).toHaveLength(before);
            const detail = await inquiries.detail(admin, r.conversationId);
            if (detail.phase !== 'active')
                throw Error('fixture');
            await inquiries.command(admin, r.conversationId, { command: 'answer', questionId: r.questionId, expectedQuestionRevision: detail.questions[0].revision, content: { clientMessageId: randomUUID(), body: '공개 답변', fileVersionIds: [] }, idempotencyKey: randomUUID() });
            expect((await event(brand, 'INQUIRY_ANSWER', r.conversationId)).disposition).toBe('eligible');
            await expect(event(team, 'INQUIRY_ANSWER', r.conversationId)).rejects.toMatchObject({ status: 404 });
            expect(await read(gsg, async (s, p) => (await inquirySchedules(s, p, r.conversationId, () => NOW)))).toEqual([]);
        });
        it('S13-07 actual G10 internal opinions3/draft0 then one public batch facts per recipient, private originals0', async () => {
            await setup();
            const target = await completionSubmission(identity, dir, taskId), corrections = new CorrectionService(identity), items = [];
            for (const key of ['one', 'two', 'three']) {
                const op = (await corrections.command(admin, { command: 'save_opinion', taskId, opinionId: null, expectedRevision: 0, opinion: { target, source: { kind: 'external_opinion', agency: '기관', reviewer: '검토자', source: 'PRIVATE_G13_SOURCE' }, originalText: 'PRIVATE_G13_ORIGINAL', internalFileVersionIds: [], receivedOn: '2026-09-21', conflictingOpinionVersionIds: [] }, idempotencyKey: randomUUID() })).ids[1];
                items.push({ key, target, internalOpinionVersionIds: [op], publicSource: '공개 설명', change: '변경', reason: '사유', publicDescription: '공개 수정', priority: 'normal', issue: 'correction' });
            }
            const id = (await corrections.command(admin, { command: 'save_draft', taskId, draftId: null, expectedRevision: 0, draft: { title: '공개 수정 묶음', summary: '공개 요약', items, mode: 'normal', pendingScopes: [], previousBatchVersionId: null }, idempotencyKey: randomUUID() })).ids[0];
            expect(await events('CORRECTION_BATCH_PUBLISHED')).toHaveLength(0);
            await corrections.command(admin, { command: 'publish', taskId, draftId: id, expectedRevision: 1, idempotencyKey: randomUUID() });
            expect(await events('CORRECTION_BATCH_PUBLISHED')).toHaveLength(1);
            const rows = await Promise.all([event(brand, 'CORRECTION_BATCH_PUBLISHED'), event(co, 'CORRECTION_BATCH_PUBLISHED')]);
            expect(rows.map(r => r.disposition)).toEqual(['eligible', 'eligible']);
            expect(rows[0].source.eventId).toBe(rows[1].source.eventId);
            expect(JSON.stringify(rows)).not.toContain('PRIVATE_G13');
        });
        it('S13-08 actual G12 selected/decline/cancellation preserve facts and no brand nag; general requirement survives decline', async () => {
            await setup();
            const f = await completionCampaign(identity);
            await f.select();
            const campaignEvent = await event(brand, 'CAMPAIGN_PUBLISHED', f.campaignId);
            expect(campaignEvent.disposition).toBe('eligible');
            const currentRequestId = (await repo.get('task', f.taskId))!.data.currentRequestId;
            const requestEvents = await events('TASK_REQUEST_REVISED', f.taskId);
            const currentEvent = requestEvents.find(e => e.data.sourceVersionId === currentRequestId)!;
            expect(currentEvent).toBeDefined();
            expect(await read(brand, async (s, p) => (await notificationEventSource(s, p, currentEvent.id, () => NOW)))).toMatchObject({ disposition: 'eligible', recipientId: 'user-luna' });
            const earlierEvents = requestEvents.filter(e => e.id !== currentEvent.id);
            expect(earlierEvents).toHaveLength(1);
            for (const old of earlierEvents)
                expect(await read(brand, async (s, p) => (await notificationEventSource(s, p, old.id, () => NOW)))).toMatchObject({ disposition: 'superseded', recipientId: 'user-luna' });
            expect((await event(gsg, 'CAMPAIGN_SELECTION_RECORDED', f.campaignId)).disposition).toBe('eligible');
            const selected = await read(brand, async (s, p) => (await campaignSchedules(s, p, f.campaignId, () => NOW)));
            expect(selected.filter(r => r.active)).not.toHaveLength(0);
            expect(selected.filter(r => !r.active)).not.toHaveLength(0);
            expect(JSON.stringify(selected)).not.toContain(campaignMarker);
            await f.applied();
            await f.select('decline');
            const records = await repo.list('campaignExternalFact');
            const noMaterials = (await schedules(brand, f.taskId))[0];
            expect(noMaterials.need).toMatchObject({ remaining: 0, required: false });
            expect(sourceReminderDecision(noMaterials, NOW).eligible).toBe(false);
            expect((await read(brand, async (s, p) => (await campaignSchedules(s, p, f.campaignId, () => NOW)))).every(r => !r.active)).toBe(true);
            expect(await repo.list('campaignExternalFact')).toEqual(records);
            const general = await completionCampaign(identity, true);
            await general.select();
            await general.applied();
            await general.select('decline');
            expect((await schedules(brand, general.taskId))[0].need).toMatchObject({ required: true, remaining: 1 });
        });
        it('S13-09 actual G11 complete/reopen evaluates live task need while immutable completion snapshot stays intact', async () => {
            await setup();
            expect(sourceReminderDecision((await schedules())[0], NOW).eligible).toBe(true);
            const id = await complete(), snapshot = await repo.get('completionSnapshot', id);
            expect(sourceReminderDecision((await schedules())[0], NOW)).toEqual({ eligible: false, reason: 'task_inactive' });
            expect((await event(brand, 'TASK_MANUALLY_COMPLETED')).disposition).toBe('eligible');
            const task = (await repo.get('task', taskId))!;
            await new CompletionService(identity).command(admin, { command: 'reopen', taskId, completionId: id, expectedTaskRevision: task.revision, reason: '추가 진행', idempotencyKey: randomUUID() });
            expect(sourceReminderDecision((await schedules())[0], NOW).eligible).toBe(true);
            expect((await event(brand, 'TASK_REOPENED')).disposition).toBe('eligible');
            expect(await repo.get('completionSnapshot', id)).toEqual(snapshot);
        });
        it('S13-10 missing assignee has explicit needs_assignment; source adapters never write events/read markers', async () => {
            await setup();
            for (const uid of ['user-luna', 'user-co'])
                await repo.transaction(async (s) => { const m = (await s.list('membership', contextId)).find(m => m.data.userId === uid)!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            const before = await Promise.all([repo.list('domainEvent'), repo.list('taskActivity'), repo.list('noticeRead'), repo.list('inquiryRead'), repo.list('commandReceipt')]);
            expect((await schedules(admin))[0].recipientState).toBe('needs_assignment');
            expect((await event(admin, 'TASK_PUBLISHED')).disposition).toBe('needs_assignment');
            expect(await Promise.all([repo.list('domainEvent'), repo.list('taskActivity'), repo.list('noticeRead'), repo.list('inquiryRead'), repo.list('commandReceipt')])).toEqual(before);
        });
    });
