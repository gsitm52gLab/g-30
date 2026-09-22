import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RecordRepository } from '@/domain/records';
import type { IdentityService } from '@/server/auth/service';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { TaskService } from '@/server/tasks/service';
import { HomeService } from '@/server/home/service';
import { SubmissionService } from '@/server/submissions/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import { NOW, policyFixture, tokenFor } from '../fixtures/policy';
const runtime = vi.hoisted(() => ({ identity: null as IdentityService | null, token: '' }));
vi.mock('@/server/auth/runtime', () => ({ identity: async () => runtime.identity!, currentToken: async () => runtime.token }));
import { readWorkspace } from '@/server/workspace';
const context = 'ctx-jp-a-luna', otherContext = 'ctx-jp-b-luna';
const admin = tokenFor('user-admin'), brand = tokenFor('user-luna');
const target = { contextId: context, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: ['product-serum'] };
const content = () => ({ ...blankContent(), title: '직접 저장 합성 업무', description: '브랜드 요청 내용', internalMemo: 'DIRECT_SAVE_PRIVATE_MEMO', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '답변' }] });
const input = () => ({ mode: 'publish', targets: [target], content: content(), category: 'spot', idempotencyKey: randomUUID() });
for (const mode of ['mock', 'sqlite'] as const) describe(`${mode} one-save task registration`, () => {
    let repo: RecordRepository, identity: IdentityService, tasks: TaskService;
    async function setup() {
        if (mode === 'mock') repo = createMockRepository(() => NOW);
        else { const db = openDatabase(':memory:', true); migrate(db); repo = createSqliteRepository(db, () => NOW); }
        identity = await policyFixture(repo); tasks = new TaskService(identity); runtime.identity = identity; runtime.token = brand;
    }
    const snapshot = async () => Promise.all((['task', 'requestVersion', 'project', 'audit', 'domainEvent', 'commandReceipt'] as const).map(k => repo.list(k)));
    afterEach(async () => { await repo?.close(); runtime.identity = null; });
    it('one save immediately reaches brand home/list/detail after reread; other context and private fields stay denied', async () => {
        await setup(); const created = await tasks.create(admin, input()), id = created.ids[0];
        const row = (await repo.get('task', id))!;
        expect(row.data).toMatchObject({ visibility: 'public', status: 'requested', ownerId: target.ownerId, assigneeId: target.assigneeId });
        expect((await tasks.detail(brand, id, context)).request?.title).toBe(content().title);
        expect((await tasks.catalog(brand, context)).tasks.some(t => t.id === id)).toBe(true);
        expect((await readWorkspace(context)).tasks.some(t => t.id === id)).toBe(true);
        const home = await new HomeService(identity).read(brand, { scope: 'context', context });
        expect(home.tasks.some(t => t.id === id)).toBe(true);
        expect(JSON.stringify(await tasks.detail(brand, id))).not.toContain('DIRECT_SAVE_PRIVATE_MEMO');
        expect((await tasks.detail(admin, id)).draft?.internalMemo).toBe('DIRECT_SAVE_PRIVATE_MEMO');
        await expect(tasks.detail(brand, id, otherContext)).rejects.toMatchObject({ status: 404 });
        await expect(tasks.detail(tokenFor('user-wave'), id)).rejects.toMatchObject({ status: 404 });
    });
    it('missing required content rolls back task, version, audit and receipt without an intermediate draft', async () => {
        await setup(); const before = await snapshot();
        for (const bad of [{ description: '' }, { requirements: [] }, { title: '' }]) {
            await expect(tasks.create(admin, { ...input(), content: { ...content(), ...bad } })).rejects.toMatchObject({ status: 422 });
            expect(await snapshot()).toEqual(before);
        }
    });
    it('failure after publication rolls back every task and request in the transaction', async () => {
        await setup(); const before = await snapshot(), failing = new TaskService(identity, () => { throw new Error('direct-save rollback'); });
        await expect(failing.create(admin, input())).rejects.toThrow('direct-save rollback');
        expect(await snapshot()).toEqual(before);
    });
    it('same idempotency key publishes one task/version/event and mismatched replay fails', async () => {
        await setup(); const body = input();
        const results = await Promise.all([tasks.create(admin, body), tasks.create(admin, body)]);
        expect(results[1]).toEqual(results[0]); const id = results[0].ids[0];
        expect((await repo.list('task')).filter(t => t.id === id)).toHaveLength(1);
        expect((await repo.list('requestVersion')).filter(v => v.data.taskId === id)).toHaveLength(1);
        expect((await repo.list('domainEvent')).filter(e => e.data.targetId === id && e.data.eventType === 'TASK_PUBLISHED')).toHaveLength(1);
        await expect(tasks.create(admin, { ...body, content: { ...body.content, description: 'different' } })).rejects.toMatchObject({ status: 409 });
    });
    it('multi-context publish stays atomic and retains each target; later invalid target leaves no first draft', async () => {
        await setup(); const second = { ...target, contextId: otherContext, ownerId: 'user-price', coAssigneeIds: [], productIds: ['product-cream'] };
        await repo.transaction(s => s.create('membership', { id: 'direct-save-second-owner', contextId: otherContext, data: { userId: 'user-price', role: 'operator', status: 'active', scope: 'synthetic', internalPriceAccess: false, activatedAt: NOW, suspendedAt: null } }));
        const c = content(); c.requirements[0].productIds = ['product-serum'];
        const body = { ...input(), targets: [target, second], content: c };
        const before = await snapshot();
        await expect(tasks.create(admin, { ...body, targets: [target, { ...second, productIds: [] }] })).rejects.toMatchObject({ status: 422 });
        expect(await snapshot()).toEqual(before);
        const created = await tasks.create(admin, body);
        for (const [i, t] of [target, second].entries()) {
            const d = await tasks.detail(brand, created.ids[i], t.contextId);
            expect(d.task.data).toMatchObject({ visibility: 'public', status: 'requested', ownerId: t.ownerId, assigneeId: t.assigneeId });
            expect(d.request!.deadline.responsibleUserId).toBe(t.ownerId);
            expect(d.request!.requirements[0].productIds).toEqual(t.productIds);
        }
    });
    it('new project publishes each selected task; invalid last template rolls back project and all tasks', async () => {
        await setup(); const body = { mode: 'publish', title: '등록 프로젝트', target, templateVersionIds: ['builtin-documents-v1', 'builtin-pop-v1'], idempotencyKey: randomUUID() };
        const invalid = (await tasks.saveTemplate(admin, { contextId: context, name: '미완성 합성', content: { ...content(), requirements: [] }, idempotencyKey: randomUUID() })).ids[0];
        const before = await snapshot();
        await expect(tasks.createProject(admin, { ...body, templateVersionIds: ['builtin-documents-v1', invalid] })).rejects.toMatchObject({ status: 422 });
        expect(await snapshot()).toEqual(before);
        const p = await tasks.createProject(admin, body); expect(await tasks.createProject(admin, body)).toEqual(p);
        const visible = await tasks.project(brand, p.ids[0]); expect(visible.tasks).toHaveLength(2);
        for (const task of visible.tasks) expect(task.data).toMatchObject({ visibility: 'public', status: 'requested', ownerId: target.ownerId, assigneeId: target.assigneeId });
    });
    it('save changes publishes atomically, preserves prior request and actual submission, and rejects stale revision', async () => {
        await setup(); const id = (await tasks.create(admin, { ...input(), targets: [{ ...target, productIds: [] }] })).ids[0], sub = new SubmissionService(identity);
        const w = await sub.workspace(brand, id);
        await sub.draft(brand, id, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: '보존할 이전 답변' } }] }, idempotencyKey: randomUUID() });
        const ready = await sub.workspace(brand, id);
        const submitted = await sub.submit(brand, id, { baseRequestId: ready.request.id, expectedDraftRevision: ready.draft!.revision, expectedTaskRevision: ready.taskRevision, mode: 'full', idempotencyKey: randomUUID() });
        const oldRequest = await repo.get('requestVersion', w.request.id), oldSubmission = await repo.get('submission', submitted.ids[0]);
        expect(oldSubmission?.data.answers[0].input).toEqual({ text: '보존할 이전 답변' });
        const row = (await repo.get('task', id))!, body = { command: 'save_publish', expectedRevision: row.revision, content: { ...content(), description: '즉시 개정 요청' }, idempotencyKey: randomUUID() };
        await tasks.command(admin, id, body); await tasks.command(admin, id, body);
        const current = await tasks.detail(brand, id);
        expect(current.request!.description).toBe('즉시 개정 요청'); expect(current.versions).toHaveLength(2);
        expect(await repo.get('requestVersion', w.request.id)).toEqual(oldRequest);
        expect(await repo.get('submission', submitted.ids[0])).toEqual(oldSubmission);
        expect(current.task.data.status).toBe('requested');
        await expect(tasks.command(admin, id, { ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
        const stable = await snapshot();
        await expect(tasks.command(admin, id, { ...body, expectedRevision: (await repo.get('task', id))!.revision, content: { ...body.content, description: '' }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
        expect(await snapshot()).toEqual(stable);
    });
    it('explicit cycle registration publishes its own request once and never changes source or old versions', async () => {
        await setup(); const id = (await tasks.create(admin, input())).ids[0], source = (await repo.get('task', id))!;
        const versions = (await repo.list('requestVersion')).filter(v => v.data.taskId === id);
        const body = { command: 'duplicate', mode: 'publish', expectedRevision: source.revision, cycle: { label: '10월', start: '2026-10-01', end: '2026-10-31' }, productIds: target.productIds, idempotencyKey: randomUUID() };
        const copied = await tasks.command(admin, id, body); expect(await tasks.command(admin, id, body)).toEqual(copied);
        const brandCopy = await tasks.detail(brand, copied.ids[0]);
        expect(brandCopy.task.data).toMatchObject({ visibility: 'public', status: 'requested', cycle: { sourceTaskId: id } });
        expect(brandCopy.versions).toHaveLength(1); expect(await repo.get('task', id)).toEqual(source);
        expect((await repo.list('requestVersion')).filter(v => v.data.taskId === id)).toEqual(versions);
        const before = await snapshot();
        await expect(tasks.command(admin, id, { ...body, expectedRevision: source.revision - 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
        expect(await snapshot()).toEqual(before);
    });
    it('existing drafts stay private until their explicit send action; brand cannot manage', async () => {
        await setup(); const a = (await tasks.create(admin, { ...input(), mode: 'draft' })).ids[0], b = (await tasks.create(admin, { ...input(), mode: 'draft' })).ids[0];
        await expect(tasks.detail(brand, a)).rejects.toMatchObject({ status: 404 });
        await expect(tasks.command(brand, a, { command: 'save_publish', expectedRevision: 1, content: content(), idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 404 });
        await tasks.command(admin, a, { command: 'save_publish', expectedRevision: 1, content: content(), idempotencyKey: randomUUID() });
        expect((await tasks.detail(brand, a)).request!.title).toBe(content().title);
        await expect(tasks.detail(brand, b)).rejects.toMatchObject({ status: 404 });
        expect((await repo.get('task', b))!.data.status).toBe('draft');
    });
});
