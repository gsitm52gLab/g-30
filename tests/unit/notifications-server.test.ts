import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoticeService } from '@/server/notices/service';
import { CorrectionService } from '@/server/corrections/service';
import { blankNotice } from '@/domain/notices/types';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { TaskService } from '@/server/tasks/service';
import { SchedulingService } from '@/server/scheduling/service';
import { NotificationService } from '@/server/notifications/service';
import { CompletionService } from '@/server/completion/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import type { ScheduleContent } from '@/domain/scheduling/types';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { admin, brand, contextId, completionInquiry, completionSubmission } from '../fixtures/completion';
import { completionCampaign, person, source } from '../fixtures/completion-campaign';

for (const mode of ['mock', 'sqlite'] as const) describe(`${mode} G13 persisted server`, () => {
    let repo: RecordRepository, identity: IdentityService, now: string, taskId: string, directory: string | undefined;
    const gsg = tokenFor('user-gsg'), co = tokenFor('user-co');
    async function setup() {
        now = NOW;
        repo = mode === 'mock' ? createMockRepository(() => now) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => now); })();
        await policyFixture(repo); identity = new IdentityService(repo, () => now);
        await repo.transaction(s => { for (const r of s.list('session')) s.update('session', r.id, r.revision, { ...r.data, expiresAt: '2026-12-01T00:00:00Z' }); });
        const c = { ...blankContent(), title: '실제 알림 업무', description: '현재 자료 제출', requirements: [{ ...blankRequirement('answer'), label: '답변' }], deadline: { ...blankContent().deadline, value: '2026-09-23', certainty: 'confirmed' as const, responsibleUserId: 'user-gsg' } };
        const task = new TaskService(identity); taskId = (await task.create(admin, { category: 'spot', content: c, targets: [{ contextId, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: ['product-serum'] }], idempotencyKey: randomUUID() })).ids[0];
        await task.command(admin, taskId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
    }
    function content(extra: Partial<ScheduleContent> = {}): ScheduleContent { return { taskId, title: '외부 검토 일정', kind: 'review', visibility: 'public', deadline: { ...blankContent().deadline, value: '2026-09-23', certainty: 'requested', responsibleUserId: 'user-gsg' }, statements: [], conflicts: [], ...extra }; }
    function save(c: ScheduleContent, scheduleId: string | null = null, expectedRevision = 0, idempotencyKey = randomUUID()) { return { command: 'save', contextId, scheduleId, expectedRevision, content: c, idempotencyKey }; }
    afterEach(async () => { repo?.close(); if (directory) { await rm(directory, { recursive: true, force: true }); directory = undefined; } });
    it('N13-01 AC13-01 manual immutable versions/conflicts/CAS/same-intent/private projection/invalid date', async () => {
        await setup(); const service = new SchedulingService(identity), original = content({ statements: [{ id: 'a', raw: ' 9/23 수요일 원문 ', source: '원문 A', version: 'v1', locator: 'p1' }, { id: 'b', raw: '9/24 목요일', source: '원문 B', version: 'v2', locator: 'p2' }], conflicts: [{ id: 'c', statementIds: ['a', 'b'], state: 'unresolved', resolution: '' }] });
        const input = save(original), result = await service.command(admin, input); expect(await service.command(admin, input)).toEqual(result);
        let detail = await service.detail(gsg, result.ids[0]); expect(detail.current.content.statements[0].raw).toBe(' 9/23 수요일 원문 '); expect(detail.calendar.reminder).toMatchObject({ eligible: false, reason: 'unresolved_conflict' });
        const first = await repo.get('scheduleVersion', result.ids[1]);
        await service.command(admin, save(content({ deadline: { ...original.deadline, timezone: 'America/New_York', value: '2026-09-25', certainty: 'expected' } }), result.ids[0], detail.revision));
        detail = await service.detail(admin, result.ids[0]); expect(detail.versions).toHaveLength(2); expect(detail.current.content.deadline).toMatchObject({ certainty: 'expected', timezone: 'America/New_York' }); expect(await repo.get('scheduleVersion', result.ids[1])).toEqual(first);
        await expect(service.command(admin, save(content(), result.ids[0], 2))).rejects.toMatchObject({ status: 409 });
        await expect(service.command(brand, save(content()))).rejects.toMatchObject({ status: 403 });
        await expect(service.command(admin, save(content({ deadline: { ...original.deadline, value: '2026-02-30' } })))).rejects.toMatchObject({ status: 422 });
        await service.command(admin, save(content({ visibility: 'internal', title: 'PRIVATE_SCHEDULE' }), result.ids[0], detail.revision));
        await expect(service.detail(brand, result.ids[0])).rejects.toMatchObject({ status: 404 }); expect(JSON.stringify(await service.list(brand, contextId))).not.toContain('PRIVATE_SCHEDULE');
    });
    it('N13-02 AC13-03 actual event + recipient atomic sync idempotency and isolated notification read', async () => {
        await setup(); const service = new NotificationService(identity), first = await service.sync(brand, contextId);
        expect(first.items.filter(n => n.source.kind === 'event')).toHaveLength(1); expect(first.items.filter(n => n.source.kind === 'reminder')).toHaveLength(1);
        await Promise.all(Array.from({ length: 8 }, () => service.sync(brand, contextId)));
        const before = await service.list(brand, contextId); expect(before.items).toHaveLength(2); expect(await repo.list('notificationReceipt')).toHaveLength(2); expect(await repo.list('notificationAttempt')).toHaveLength(2);
        const markers = await Promise.all([repo.list('taskActivity'), repo.list('noticeRead'), repo.list('inquiryRead')]), row = before.items[0], command = { read: true, expectedRevision: row.revision, idempotencyKey: randomUUID() };
        await service.read(brand, row.id, command); await service.read(brand, row.id, command); expect((await service.list(brand, contextId)).unread).toBe(1);
        await expect(service.read(co, row.id, command)).rejects.toMatchObject({ status: 404 });
        expect(await Promise.all([repo.list('taskActivity'), repo.list('noticeRead'), repo.list('inquiryRead')])).toEqual(markers);
        await service.read(brand, row.id, { read: false, expectedRevision: row.revision + 1, idempotencyKey: randomUUID() }); expect((await service.list(brand, contextId)).unread).toBe(2);
        expect(before.delivery).toEqual({ inApp: 'app_open_sync', email: 'not_connected', background: 'not_connected' });
    });
    it('N13-03 AC13-02/03 publication canonical same recipient1; selection/fact actual request keeps brand alerts', async () => {
        await setup(); const f = await completionCampaign(identity), service = new NotificationService(identity);
        for (const token of [brand, co]) {
            await service.sync(token, contextId);
            const notices = (await service.list(token, contextId)).items.filter(n => n.source.kind === 'event' && (n.title === '실제 행사' || n.title === '실제 캠페인 완료'));
            expect(notices).toHaveLength(1); expect(notices[0].source.kind === 'event' && (await repo.get('domainEvent', notices[0].source.eventId))?.data.eventType).toBe('CAMPAIGN_PUBLISHED');
        }
        expect((await repo.list('notificationReceipt')).filter(r => r.data.deduplicated)).toHaveLength(2);
        await f.select();
        const selectionRequest = (await repo.get('task', f.taskId))!.data.currentRequestId;
        for (const token of [brand, co, gsg]) await service.sync(token, contextId);
        const selectedEvent = (await repo.list('domainEvent')).find(e => e.data.eventType === 'TASK_REQUEST_REVISED' && e.data.sourceVersionId === selectionRequest)!;
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'event' && n.data.source.eventId === selectedEvent.id).map(n => n.data.recipientId).sort()).toEqual(['user-co', 'user-luna']);
        const selectionEvent = (await repo.list('domainEvent')).find(e => e.data.eventType === 'CAMPAIGN_SELECTION_RECORDED' && e.data.targetId === f.campaignId)!;
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'event' && n.data.source.eventId === selectionEvent.id).map(n => n.data.recipientId)).toEqual(['user-gsg']);
        await f.command('external', { campaignVersionId: f.versionId, menu: f.draft.menus[0].identity, fact: { axis: 'selection', value: 'not_selected', requester: person, performedBy: person, occurredAt: null, source: source(), note: '' } });
        const latest = (await repo.get('task', f.taskId))!.data.currentRequestId, revisionEvent = (await repo.list('domainEvent')).find(e => e.data.sourceVersionId === latest)!;
        for (const token of [brand, co, gsg]) await service.sync(token, contextId);
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'event' && n.data.source.eventId === revisionEvent.id).map(n => n.data.recipientId).sort()).toEqual(['user-co', 'user-luna']);
        const factIds = (await repo.list('domainEvent')).filter(e => e.data.eventType === 'CAMPAIGN_FACT_RECORDED').map(e => e.id);
        expect((await repo.list('notification')).some(n => n.data.source.kind === 'event' && factIds.includes(n.data.source.eventId))).toBe(false);
    });
    it('N13-04 AC13-03 fault after notification rolls back, failure retry persists exact one notice+receipt', async () => {
        await setup(); const broken = new NotificationService(identity, { fault: () => { throw Error('synthetic transaction failure'); } });
        const failed = await broken.sync(brand, contextId); expect(failed.failed).toBe(2); expect(await repo.list('notification')).toHaveLength(0); expect(await repo.list('notificationReceipt')).toHaveLength(0); expect(failed.failures).toHaveLength(2);
        await broken.sync(brand, contextId); expect(await repo.list('notificationAttempt')).toHaveLength(2);
        const healthy = new NotificationService(identity); for (const item of failed.failures) { await healthy.retry(brand, item.id); await healthy.retry(brand, item.id); }
        expect(await repo.list('notification')).toHaveLength(2); expect(await repo.list('notificationReceipt')).toHaveLength(2); expect((await healthy.list(brand, contextId)).failures).toHaveLength(0);
    });
    it('N13-05 AC13-03 current authority rechecked after candidate collection and before any failed attempt', async () => {
        await setup(); let changed = false;
        const service = new NotificationService(identity, { beforeDelivery: async () => { if (changed) return; changed = true; await repo.transaction(s => { const m = s.list('membership', contextId).find(r => r.data.userId === 'user-luna')!; s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' }); }); } });
        await expect(service.sync(brand, contextId)).rejects.toMatchObject({ status: 404 }); expect(await repo.list('notification')).toHaveLength(0); expect(await repo.list('notificationAttempt')).toHaveLength(0);
    });
    it('N13-06 AC13-01/04 D-2/day/overdue only current local day; completion and reopen reevaluate without catchup', async () => {
        await setup(); const service = new NotificationService(identity);
        await service.sync(brand, contextId); now = '2026-09-23T12:00:00Z'; await service.sync(brand, contextId); now = '2026-09-25T12:00:00Z'; await service.sync(brand, contextId); await service.sync(brand, contextId);
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'reminder').map(n => n.data.source.kind === 'reminder' ? n.data.source.localDay : '').sort()).toEqual(['2026-09-21', '2026-09-23', '2026-09-25']);
        const complete = new CompletionService(identity), w = await complete.workspace(admin, taskId), done = await complete.command(admin, { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() });
        now = '2026-09-26T12:00:00Z'; await service.sync(brand, contextId); expect((await repo.list('notification')).filter(n => n.data.source.kind === 'reminder')).toHaveLength(3);
        const task = (await repo.get('task', taskId))!; await complete.command(admin, { command: 'reopen', taskId, completionId: done.ids[0], expectedTaskRevision: task.revision, reason: '자료 보완', idempotencyKey: randomUUID() }); await service.sync(brand, contextId);
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'reminder')).toHaveLength(4);
    });
    it('N13-08 SA-52 explicit task-assigned brand shipping gets next action; arbitrary team member rejected', async () => {
        await setup(); const scheduling = new SchedulingService(identity), notifications = new NotificationService(identity);
        const input = content({ kind: 'shipping', deadline: { ...content().deadline, responsibleUserId: 'user-luna' } });
        const id = (await scheduling.command(admin, save(input))).ids[0];
        const detail = await scheduling.detail(brand, id);
        expect(detail.calendar).toMatchObject({ recipientState: 'current_recipient', reminder: { eligible: true, recipientId: 'user-luna' } });
        await notifications.sync(brand, contextId);
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'reminder' && n.data.source.logicalKey === `manual:${id}`).map(n => n.data.recipientId)).toEqual(['user-luna']);
        await expect(scheduling.command(admin, save({ ...input, deadline: { ...input.deadline, responsibleUserId: 'user-team' } }))).rejects.toMatchObject({ status: 422 });
    });
    it('N13-09 SA-52 submission recipients are current task assignees; confirmation actor policy is explicit', async () => {
        await setup(); const scheduling = new SchedulingService(identity), id = (await scheduling.command(admin, save(content({ kind: 'submission' })))).ids[0];
        for (const token of [brand, co]) expect((await scheduling.detail(token, id)).calendar).toMatchObject({ recipientPolicy: 'task_assignees', recipientState: 'current_recipient', deadline: { responsibleUserId: 'user-gsg' } });
        expect((await scheduling.detail(gsg, id)).calendar).toMatchObject({ recipientPolicy: 'task_assignees', recipientState: 'other_recipient' });
    });
    it('N13-10 SA-52 explicit brand operation follows current assignment, completion and campaign nonparticipation', async () => {
        await setup(); const scheduling = new SchedulingService(identity), notifications = new NotificationService(identity), f = await completionCampaign(identity); await f.select();
        const manual = (await scheduling.command(admin, save(content({ taskId: f.taskId, kind: 'shipping', deadline: { ...content().deadline, responsibleUserId: 'user-co' } })))).ids[0];
        expect((await scheduling.detail(co, manual)).calendar.reminder).toMatchObject({ eligible: true, recipientId: 'user-co' });
        await notifications.sync(co, contextId); const baseline = (await repo.list('notification')).filter(n => n.data.source.kind === 'reminder' && n.data.source.logicalKey === `manual:${manual}`).length; expect(baseline).toBe(1);
        await f.select('decline'); now = '2026-09-23T12:00:00Z';
        expect((await scheduling.detail(co, manual)).calendar.reminder).toMatchObject({ eligible: false, reason: 'participation_inactive' }); await notifications.sync(co, contextId);
        expect((await repo.list('notification')).filter(n => n.data.source.kind === 'reminder' && n.data.source.logicalKey === `manual:${manual}`)).toHaveLength(baseline);
        const ordinary = (await scheduling.command(admin, save(content({ kind: 'shipping', deadline: { ...content().deadline, responsibleUserId: 'user-co' } })))).ids[0];
        const completion = new CompletionService(identity), w = await completion.workspace(admin, taskId); await completion.command(admin, { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() });
        expect((await scheduling.detail(co, ordinary)).calendar.reminder).toMatchObject({ eligible: false, reason: 'task_inactive' });
        const current = (await repo.get('task', f.taskId))!; await new TaskService(identity).command(admin, f.taskId, { command: 'assign', expectedRevision: current.revision, assignment: { ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [] }, idempotencyKey: randomUUID() });
        expect((await scheduling.detail(co, manual)).calendar.recipientState).toBe('needs_assignment');
    });
    it('N13-11 AC13-02/03 real notice and multi-item correction draft0/public recipient1, read markers unchanged', async () => {
        await setup(); directory = await mkdtemp(join(tmpdir(), 'g13-notification-')); const notifications = new NotificationService(identity), notices = new NoticeService(identity), corrections = new CorrectionService(identity);
        const noticeId = (await notices.create(admin, { contextId, content: { ...blankNotice(), title: '공지 수신', body: '공개', audience: { mode: 'selected', userIds: ['user-luna'] } }, idempotencyKey: randomUUID() })).ids[0];
        const target = await completionSubmission(identity, directory, taskId), items = [];
        for (const key of ['one', 'two', 'three']) {
            const opinion = (await corrections.command(admin, { command: 'save_opinion', taskId, opinionId: null, expectedRevision: 0, opinion: { target, source: { kind: 'external_opinion', agency: '기관', reviewer: '검토자', source: 'PRIVATE_NOTIFICATION_SOURCE' }, originalText: 'PRIVATE_NOTIFICATION_ORIGINAL', internalFileVersionIds: [], receivedOn: '2026-09-21', conflictingOpinionVersionIds: [] }, idempotencyKey: randomUUID() })).ids[1];
            items.push({ key, target, internalOpinionVersionIds: [opinion], publicSource: '공개 수정', change: '변경', reason: '사유', publicDescription: '공개 내용', priority: 'normal', issue: 'correction' });
        }
        const draft = (await corrections.command(admin, { command: 'save_draft', taskId, draftId: null, expectedRevision: 0, draft: { title: '공개 보완 묶음', summary: '보완 세 항목', items, mode: 'normal', pendingScopes: [], previousBatchVersionId: null }, idempotencyKey: randomUUID() })).ids[0];
        await notifications.sync(brand, contextId); expect((await notifications.list(brand, contextId)).items.some(n => ['공지 수신', '공개 보완 묶음'].includes(n.title))).toBe(false);
        await notices.command(admin, noticeId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }); await corrections.command(admin, { command: 'publish', taskId, draftId: draft, expectedRevision: 1, idempotencyKey: randomUUID() });
        for (const token of [brand, co]) { await notifications.sync(token, contextId); await notifications.sync(token, contextId); const list = await notifications.list(token, contextId); expect(list.items.filter(n => n.title === '공개 보완 묶음')).toHaveLength(1); expect(list.items.filter(n => n.title === '공지 수신')).toHaveLength(token === brand ? 1 : 0); }
        expect(await repo.list('noticeRead')).toHaveLength(0); expect(JSON.stringify(await notifications.list(brand, contextId))).not.toContain('PRIVATE_NOTIFICATION');
    });
    it('N13-07 actual G04 activity identity and external wait GSG-only source remain separate', async () => {
        await setup(); const task = (await repo.get('task', taskId))!;
        await new TaskService(identity).command(brand, taskId, { command: 'schedule', expectedRevision: task.revision, reason: '일정 조정', deadline: { ...blankContent().deadline, value: '2026-09-25', responsibleUserId: 'user-luna' }, idempotencyKey: randomUUID() });
        const e = (await repo.list('domainEvent')).find(e => e.data.eventType === 'TASK_SCHEDULE_CHANGE_REQUESTED')!; expect((await repo.get('taskActivity', e.data.sourceVersionId!))?.data.kind).toBe('schedule');
        await completionInquiry(identity, taskId); now = '2026-10-03T12:00:00Z';
        const service = new NotificationService(identity); await service.sync(gsg, contextId); await service.sync(brand, contextId);
        const external = (await repo.list('notification')).filter(n => n.data.source.kind === 'reminder' && n.data.source.source.kind === 'inquiry_external'); expect(external.map(n => n.data.recipientId)).toEqual(['user-gsg']);
    });
});
