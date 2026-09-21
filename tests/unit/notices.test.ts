import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository, RecordKind, UnitOfWork, StoredRecord } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { NoticeService } from '@/server/notices/service';
import { FileService } from '@/server/files/service';
import { blankNotice, type NoticeContent } from '@/domain/notices/types';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
const A = 'ctx-jp-a-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna'), team = tokenFor('user-team'), foreign = tokenFor('user-wave');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G08 notice invariants`, () => {
        let repo: RecordRepository, identity: IdentityService, service: NoticeService, files: FileService, dir: string;
        let now = NOW;
        async function setup() { now = NOW; repo = mode === 'mock' ? createMockRepository(() => now) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => now); })(); identity = await policyFixture(repo); identity.clock = () => now; service = new NoticeService(identity); dir = await mkdtemp(path.join(os.tmpdir(), 'gs-hale-notice-')); files = new FileService(identity, dir); }
        async function create(content: NoticeContent = { ...blankNotice(), title: '합성 공지', body: '자료와 별도 업무 안내' }, contextId = A) { return (await service.create(admin, { contextId, content, idempotencyKey: randomUUID() })).ids[0]; }
        async function command(id: string, command: string, extra: Record<string, unknown> = {}) { return service.command(admin, id, { command, expectedRevision: (await repo.get('notice', id))!.revision, idempotencyKey: randomUUID(), ...extra }); }
        async function publish(id: string) { return (await command(id, 'publish')).ids[1]; }
        const business = async () => Promise.all((['notice', 'noticeVersion', 'noticeRead', 'commandReceipt', 'audit', 'domainEvent'] as RecordKind[]).map(k => repo.list(k)));
        afterEach(async () => {
            repo?.close();
            if (dir)
                await rm(dir, { recursive: true, force: true });
        });
        it('AC08-01 private drafts and foreign scopes deny; own receipt is server attributed and roster GSG only', async () => {
            await setup();
            const id = await create();
            await expect(service.detail(brand, id)).rejects.toMatchObject({ status: 404 });
            expect((await service.list(brand, A)).items).toEqual([]);
            await expect(service.detail(admin,id,'')).rejects.toMatchObject({status:422});
            const v = await publish(id), read = { command: 'read', versionId: v, idempotencyKey: randomUUID() };
            const first = await service.command(brand, id, read);
            expect(await service.command(brand, id, read)).toEqual(first);
            expect(await service.command(brand, id, { ...read, idempotencyKey: randomUUID() })).toEqual(first);
            expect((await repo.list('noticeRead')).map(x => x.data)).toEqual([{ noticeId: id, versionId: v, userId: 'user-luna', readAt: NOW }]);
            const dto = await service.detail(brand, id);
            expect(dto.selected?.ownReadAt).toBe(NOW);
            expect(dto).not.toHaveProperty('draft');
            expect(dto).not.toHaveProperty('roster');
            const managed = await service.detail(admin, id);
            expect('roster' in managed && managed.roster.reads).toHaveLength(1);
            await expect(service.detail(foreign, id)).rejects.toMatchObject({ status: 404 });
            expect((await service.detail(tokenFor('user-selected-admin'), id)).capabilities.manage).toBe(true);
            const other = await create({ ...blankNotice(), title: '다른 범위', body: '타 컨텍스트' }, 'ctx-empty');
            await publish(other);
            await expect(service.detail(tokenFor('user-gsg'), other)).rejects.toMatchObject({ status: 404 });
        });
        it('AC08-03 immutable v1 files/read persist, v2 unread and distinct version events; draft emits no public event', async () => {
            await setup();
            const id = await create(), ref = { kind: 'notice' as const, noticeId: id };
            const f1 = (await files.upload(admin, ref, [{ name: 'first.png', type: 'image/png', bytes: png }], 'public')).files[0];
            await expect(files.download(brand, f1.id, ref, 'original')).rejects.toMatchObject({ status: 404 });
            await command(id, 'save', { content: { ...blankNotice(), title: 'v1 안내', body: '과거 본문', fileIds: [f1.id] } });
            const v1 = await publish(id);
            await service.command(brand, id, { command: 'read', versionId: v1, idempotencyKey: randomUUID() });
            const saved = await repo.get('noticeVersion', v1), reads = await repo.list('noticeRead');
            const f2 = (await files.upload(admin, ref, [{ name: 'second.png', type: 'image/png', bytes: png }], 'public')).files[0];
            const events = await repo.list('domainEvent');
            await command(id, 'save', { content: { ...blankNotice(), title: 'v2 안내', body: '개정 본문', fileIds: [f2.id], changeSummary: '양식 개정' } });
            expect(await repo.list('domainEvent')).toEqual(events);
            expect(JSON.stringify(await service.detail(brand, id))).not.toContain('개정 본문');
            const v2 = await publish(id);
            expect((await service.detail(brand, id)).selected?.ownReadAt).toBeNull();
            expect(await repo.get('noticeVersion', v1)).toEqual(saved);
            expect(await repo.list('noticeRead')).toEqual(reads);
            expect((await files.download(brand, f1.id, { ...ref, versionId: v1 }, 'original')).bytes).toEqual(png);
            await expect(files.download(brand, f1.id, { ...ref, versionId: v2 }, 'original')).rejects.toMatchObject({ status: 404 });
            expect((await repo.list('domainEvent')).filter(e => e.data.targetId === id).map(e => e.data.sourceVersionId).sort()).toEqual([v1, v2].sort());
            await expect(repo.transaction(s => s.update('noticeVersion', v1, s.get('noticeVersion', v1)!.revision, s.get('noticeVersion', v1)!.data))).rejects.toBeDefined();
        });
        it('all-member rule includes later active members; explicit empty selected never expands; current target AND historical target apply', async () => {
            await setup();
            const id = await create({ ...blankNotice(), title: '대상 없는 컨텍스트', body: '가입 후 보이는 안내' }, 'ctx-empty'), v = await publish(id), before = await service.detail(admin, id);
            expect('roster' in before && before.roster.targetCount).toBe(0);
            await repo.transaction(s => s.create('membership', { id: randomUUID(), contextId: 'ctx-empty', data: { userId: 'user-none', role: 'brand', status: 'active', scope: '', internalPriceAccess: false, activatedAt: NOW, suspendedAt: null } }));
            expect((await service.detail(tokenFor('user-none'), id)).selected?.id).toBe(v);
            const other = await create({ ...blankNotice(), title: '선택 공지', body: '선택 공개', audience: { mode: 'selected', userIds: ['user-luna'] } }), v1 = await publish(other);
            await expect(service.detail(team, other)).rejects.toMatchObject({ status: 404 });
            await command(other, 'save', { content: { ...blankNotice(), title: '전체 공개', body: '새 본문' } });
            await publish(other);
            expect((await service.detail(team, other)).versions).toHaveLength(1);
            expect(JSON.stringify(await service.detail(team, other))).not.toContain(v1);
            await expect(service.detail(team, other, v1)).rejects.toMatchObject({ status: 404 });
            await command(other, 'save', { content: { ...blankNotice(), title: '아무도 없음', body: '선택 없음', audience: { mode: 'selected', userIds: [] } } });
            await publish(other);
            await expect(service.detail(brand, other, v1)).rejects.toMatchObject({ status: 404 });
        });
        it('late publication failure rolls back version/current/event/audit/receipt; CAS/idempotency and fresh revoke stay atomic', async () => {
            await setup();
            const id = await create(), input = { command: 'publish', expectedRevision: (await repo.get('notice', id))!.revision, idempotencyKey: randomUUID() }, before = await business();
            await expect(new NoticeService(identity, () => { throw new Error('late publish'); }).command(admin, id, input)).rejects.toThrow('late publish');
            expect(await business()).toEqual(before);
            const good = await service.command(admin, id, input);
            expect(await service.command(admin, id, input)).toEqual(good);
            await expect(service.command(admin, id, { ...input, versionId: 'different' })).rejects.toMatchObject({ status: 409 });
            await expect(service.command(admin, id, { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
            const read = { command: 'read', versionId: good.ids[1], idempotencyKey: randomUUID() };
            await service.command(brand, id, read);
            await repo.transaction(s => { const m = s.list('membership', A).find(x => x.data.userId === 'user-luna')!; s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' }); });
            await expect(service.command(brand, id, read)).rejects.toMatchObject({ status: 404 });
            expect(await repo.list('noticeRead')).toHaveLength(1);
        });
        it('AC08-02 actual G04 task and G05 submitted file stay byte-for-byte unchanged after notice read', async () => {
            await setup();
            const tasks = new TaskService(identity), sub = new SubmissionService(identity), upload = new SubmissionFiles(identity, dir);
            const c = { ...blankContent(), title: '연결된 실제 요청', description: '제출 요청', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '답변' }] };
            const taskId = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], content: c, category: 'spot', idempotencyKey: randomUUID() })).ids[0];
            await tasks.command(admin, taskId, { command: 'publish', expectedRevision: (await repo.get('task', taskId))!.revision, idempotencyKey: randomUUID() });
            let w = await sub.workspace(brand, taskId);
            const uploaded = (await upload.upload(brand, taskId, w.request.id, [{ clientItemId: randomUUID(), name: 'submitted.png', type: 'image/png', bytes: png }])).items[0];
            if (uploaded.state !== 'ready')
                throw Error('fixture upload');
            await sub.draft(brand, taskId, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: '제출 답변' } }], artifacts: [{ fileVersionId: uploaded.file.id, role: 'editable_original', answer: null }] }, idempotencyKey: randomUUID() });
            w = await sub.workspace(brand, taskId);
            await sub.submit(brand, taskId, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'full', idempotencyKey: randomUUID() });
            const id = await create({ ...blankNotice(), title: '연결 안내', body: '별도 업무에서 제출', taskIds: [taskId], fileIds: [uploaded.file.id] }), v = await publish(id);
            const kinds: RecordKind[] = ['task', 'requestVersion', 'taskActivity', 'submission', 'submissionDraft', 'productUseSnapshot', 'fileVersion'], before = await Promise.all(kinds.map(k => repo.list(k)));
            await service.command(brand, id, { command: 'read', versionId: v, idempotencyKey: randomUUID() });
            expect(await Promise.all(kinds.map(k => repo.list(k)))).toEqual(before);
            expect((await service.detail(brand, id)).selected?.content.tasks[0]).toMatchObject({ id: taskId, status: 'submitted', ownAcceptedAt: null, completed: false });
            expect((await files.download(brand, uploaded.file.id, { kind: 'notice', noticeId: id, versionId: v }, 'original')).bytes).toEqual(png);
        });
        it('corrupted known sequence never crosses read projections; valid unknown extensions retain immutable history', async () => {
            await setup();
            const id = await create(), v = await publish(id), original = (await repo.get('noticeVersion', v))!;
            await expect(repo.transaction(s => s.create('noticeVersion', { id: randomUUID(), contextId: A, data: { ...original.data, sequence: { secret: 'G08_SEQUENCE_CANARY' } } as unknown as typeof original.data }))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
            // Native write guards are not weakened. Simulate an adapter read corruption below the service boundary.
            const corrupt = (r: StoredRecord | null) => r?.kind === 'noticeVersion' && r.id === v ? { ...r, data: { ...r.data, sequence: { secret: 'G08_SEQUENCE_CANARY' } } } : r;
            const wrapped: RecordRepository = { ...repo, transaction: async (operation) => repo.transaction(s => operation(new Proxy(s, { get(target, prop: keyof UnitOfWork) { return (...args: unknown[]) => { const result = Reflect.apply(target[prop], target, args); return prop === 'get' ? corrupt(result) : prop === 'list' ? result.map(corrupt) : result; }; } }))) };
            const faulty = new NoticeService(new IdentityService(wrapped, () => NOW));
            await expect(faulty.detail(brand, id)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
            await expect(faulty.list(brand, A)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
            expect(await repo.get('noticeVersion', v)).toEqual(original);
            const extended = await repo.transaction(s => { const n = s.get('notice', id)!, version = s.create('noticeVersion', { id: randomUUID(), contextId: A, data: { ...original.data, sequence: 2, previousId: v, extra: { secret: 'G08_EXTRA_CANARY' } } as typeof original.data }); s.update('notice', id, n.revision, { ...n.data, currentVersionId: version.id }); return version; });
            expect(JSON.stringify(await service.detail(brand, id))).not.toContain('G08_EXTRA_CANARY');
            expect(await repo.get('noticeVersion', extended.id)).toEqual(extended);
        });
        it('brand public metadata and ordering do not change on a private draft save', async () => {
            await setup();
            const id = await create();
            now = new Date(Date.parse(NOW) + 60000).toISOString();
            await publish(id);
            now = new Date(Date.parse(NOW) + 90000).toISOString();
            const second = await create({ ...blankNotice(), title: '더 최근 공개', body: '두 번째 안내' });
            await publish(second);
            const beforeList = (await service.list(brand, A)).items, before = beforeList.find(n => n.id === id)!, managedBefore = await service.detail(admin, id);
            expect(before.updatedAt).toBe(before.publishedAt);
            expect(before.revision).toBe(before.sequence);
            expect(beforeList[0].id).toBe(second);
            now = new Date(Date.parse(NOW) + 120000).toISOString();
            await command(id, 'save', { content: { ...blankNotice(), title: 'PRIVATE_DRAFT_TITLE', body: 'PRIVATE_DRAFT_BODY' } });
            expect((await service.list(brand, A)).items).toEqual(beforeList);
            expect((await service.detail(brand, id)).revision).toBe(before.sequence);
            const managed = (await service.list(admin, A)).items.find(n => n.id === id)!;
            expect(managed.revision).toBe(managedBefore.revision + 1);
            expect(managed.updatedAt).toBe(now);
            expect(managed.updatedAt).not.toBe(before.publishedAt);
            expect(managed.title).toBe('PRIVATE_DRAFT_TITLE');
        });
        it('notice file bytes require current authorization both before and after asynchronous file IO', async () => {
            await setup();
            const id = await create(), ref = { kind: 'notice' as const, noticeId: id }, file = (await files.upload(admin, ref, [{ name: 'file.png', type: 'image/png', bytes: png }], 'public')).files[0];
            await command(id, 'save', { content: { ...blankNotice(), title: '파일', body: '확인', fileIds: [file.id] } });
            const versionId = await publish(id);
            let calls = 0;
            const wrapped: RecordRepository = { ...repo, transaction: async (op) => {
                    const result = await repo.transaction(op);
                    if (++calls === 1)
                        await repo.transaction(s => { const m = s.list('membership', A).find(x => x.data.userId === 'user-luna')!; s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' }); });
                    return result;
                } };
            await expect(new FileService(new IdentityService(wrapped, () => NOW), dir).download(brand, file.id, { ...ref, versionId }, 'original')).rejects.toMatchObject({ status: 404 });
            expect(calls).toBe(1);
        });
    });
