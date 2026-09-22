import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository, RecordKind } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { InquiryService } from '@/server/inquiries/service';
import { InquiryFiles } from '@/server/inquiries/files';
import { FileService } from '@/server/files/service';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
const A = 'ctx-jp-a-luna', brand = tokenFor('user-team'), peer = tokenFor('user-luna'), gsg = tokenFor('user-gsg'), admin = tokenFor('user-admin');
const content = (body = '질문 원문', fileVersionIds: string[] = []) => ({ clientMessageId: randomUUID(), body, fileVersionIds });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G09 actual service`, async () => {
        let repo: RecordRepository, identity: IdentityService, service: InquiryService, files: InquiryFiles, download: FileService, dir: string;
        async function setup() { repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); identity = await policyFixture(repo); service = new InquiryService(identity); dir = await mkdtemp(path.join(os.tmpdir(), 'gs-inquiry-')); files = new InquiryFiles(identity, dir); download = new FileService(identity, dir); }
        const list = async (actor = brand) => (await service.list(actor, new URLSearchParams({ context: A })));
        const draft = async () => (await service.createDraft(brand, { contextId: A, taskId: null, idempotencyKey: randomUUID() }));
        async function active() { const d = await draft(); await service.command(brand, d.conversationId, { command: 'publish_first', expectedRevision: d.revision, title: '독립 질문', content: content(), idempotencyKey: randomUUID() }); return d.conversationId; }
        async function publicDetail(id: string, actor = brand) { const d = await service.detail(actor, id); if (d.phase !== 'active')
            throw Error('active expected'); return d; }
        async function upload(id: string, actor = brand, visibility: 'public' | 'internal' = 'public', clientItemId = randomUUID()) { const result = await files.upload(actor, id, [{ clientItemId, name: 'proof.png', type: 'image/png', bytes: png }], visibility); const item = result.items[0]; if (item.state !== 'ready')
            throw Error(JSON.stringify(item)); return item.file; }
        const business = () => Promise.all((['conversation', 'inquiryQuestion', 'inquiryMessage', 'inquiryTransition', 'inquiryRead', 'inquiryEvent', 'commandReceipt', 'audit', 'domainEvent'] as RecordKind[]).map(k => repo.list(k)));
        afterEach(async () => { repo?.close(); if (dir)
            await rm(dir, { recursive: true, force: true }); });
        it('AC09-02 draft is initiator-only even admin; first attachment-only publishes selected exact bytes once', async () => {
            await setup();
            const input = { contextId: A, taskId: null, idempotencyKey: randomUUID() }, a = await service.createDraft(brand, input);
            expect(await service.createDraft(brand, input)).toEqual(a);
            expect((await list()).total).toBe(0);
            expect((await list(gsg)).counts.questions).toBe(0);
            for (const t of [peer, gsg, admin, tokenFor('user-wave')])
                await expect((await service.detail(t, a.conversationId))).rejects.toMatchObject({ status: 404 });
            await expect((await service.createDraft(gsg, input))).rejects.toMatchObject({ status: 403 });
            const f = await upload(a.conversationId), unused = await upload(a.conversationId);
            await expect((await download.download(gsg, f.id, { kind: 'inquiry', conversationId: a.conversationId }, 'download'))).rejects.toMatchObject({ status: 404 });
            expect(await repo.list('inquiryMessage')).toHaveLength(0);
            expect(await repo.list('inquiryEvent')).toHaveLength(0);
            const send = { command: 'publish_first', title: '파일만 질문', expectedRevision: a.revision, content: content('', [f.id]), idempotencyKey: randomUUID() }, out = await service.command(brand, a.conversationId, send);
            expect(await service.command(brand, a.conversationId, send)).toEqual(out);
            expect(await service.command(brand, a.conversationId, { ...send, idempotencyKey: randomUUID() })).toEqual(out);
            expect((await publicDetail(a.conversationId, gsg)).messages[0].files.map(x => x.id)).toEqual([f.id]);
            expect((await download.download(gsg, f.id, { kind: 'inquiry', conversationId: a.conversationId, messageId: out.messageId! }, 'original')).bytes).toEqual(png);
            await expect((await download.download(gsg, unused.id, { kind: 'inquiry', conversationId: a.conversationId, messageId: out.messageId! }, 'original'))).rejects.toMatchObject({ status: 404 });
            await expect((await download.download(peer, f.id, { kind: 'inquiry', conversationId: a.conversationId, messageId: out.messageId! }, 'original'))).rejects.toMatchObject({ status: 404 });
            await expect((await service.command(brand, a.conversationId, { ...send, content: { ...send.content, body: '다른 내용' } }))).rejects.toMatchObject({ status: 409 });
            expect(await repo.list('inquiryQuestion')).toHaveLength(1);
            expect(await repo.list('inquiryMessage')).toHaveLength(1);
        });
        it('AC09-01 five questions four answers leave external waiting; ack/internal note do not answer and new question preserves resolutions', async () => {
            await setup();
            const id = await active();
            for (let i = 1; i < 5; i++)
                await service.command(brand, id, { command: 'question', expectedRevision: (await publicDetail(id)).revision, content: content('질문 ' + i), idempotencyKey: randomUUID() });
            let d = await publicDetail(id, gsg);
            for (const q of d.questions.slice(0, 4))
                await service.command(gsg, id, { command: 'answer', questionId: q.id, expectedQuestionRevision: q.revision, content: content('실제 답변'), idempotencyKey: randomUUID() });
            d = await publicDetail(id, gsg);
            const q = d.questions.find(q => q.state !== 'resolved')!;
            await service.command(gsg, id, { command: 'state', questionId: q.id, expectedQuestionRevision: q.revision, state: 'external_waiting', reason: '외부 일정 확인', externalWait: { counterparty: '리테일러 담당', sentAt: '2026-09-21T15:30:00+09:00', responsibleUserId: 'user-gsg', nextCheckDate: '2026-10-05', timezone: 'Asia/Tokyo', latestResult: '회신 대기' }, idempotencyKey: randomUUID() });
            const before = await publicDetail(id);
            await service.command(gsg, id, { command: 'internal_note', questionId: q.id, content: content('PRIVATE_INTERNAL'), idempotencyKey: randomUUID() });
            expect(await publicDetail(id)).toEqual(before);
            await service.command(gsg, id, { command: 'message', kind: 'acknowledgement', questionId: q.id, content: content('확인 중'), idempotencyKey: randomUUID() });
            for (const t of [brand, gsg]) {
                const d = await publicDetail(id, t);
                expect(d.counts).toEqual({ questions: 5, answered: 4, unresolved: 1, waitingGsg: 0, waitingBrand: 0, externalWaiting: 1 });
                expect(d.nextChecks[0].date).toBe('2026-10-05');
                expect((await service.summary(t, A)).counts).toEqual(d.counts);
            }
            const current = (await publicDetail(id, gsg)).questions.find(x => x.id === q.id)!;
            await service.command(gsg, id, { command: 'answer', questionId: q.id, expectedQuestionRevision: current.revision, content: content('일정 답변'), idempotencyKey: randomUUID() });
            const resolved = await publicDetail(id);
            expect(resolved.lastResolvedAt).toBe(NOW);
            await service.command(brand, id, { command: 'question', expectedRevision: resolved.revision, content: content('추가 질문'), idempotencyKey: randomUUID() });
            const reopened = await publicDetail(id);
            expect(reopened.lastResolvedAt).toBe(NOW);
            expect(reopened.counts).toMatchObject({ questions: 6, answered: 5, unresolved: 1 });
            expect(reopened.history.length).toBeGreaterThan(resolved.history.length);
        });
        it('AC09-03 durable cursors recover exactly two missed messages once and internal positions never alter public output', async () => {
            await setup();
            const id = await active(), before = await publicDetail(id), staffBefore = await publicDetail(id, gsg);
            await service.command(gsg, id, { command: 'internal_note', questionId: null, content: content('INTERNAL_CURSOR_MARKER'), idempotencyKey: randomUUID() });
            expect(await publicDetail(id)).toEqual(before);
            expect((await service.events(brand, id, new URLSearchParams({ after: before.cursor }))).events).toEqual([]);
            const staffEvents = await service.events(gsg, id, new URLSearchParams({ after: staffBefore.cursor }));
            expect(staffEvents.events.map(e => e.type)).toEqual(['internal_message']);
            for (let i = 0; i < 2; i++)
                await service.command(gsg, id, { command: 'message', kind: 'comment', questionId: null, content: content('추가 ' + i), idempotencyKey: randomUUID() });
            const p = await service.events(brand, id, new URLSearchParams({ after: before.cursor }));
            expect(p.events.map(e => e.type)).toEqual(['message', 'message']);
            expect(JSON.stringify(p)).not.toContain('INTERNAL_CURSOR_MARKER');
            expect((await service.events(brand, id, new URLSearchParams({ after: p.cursor }))).events).toEqual([]);
            await expect((await service.events(gsg, id, new URLSearchParams({ after: p.cursor })))).rejects.toMatchObject({ status: 409 });
            const other = await active();
            await expect((await service.events(brand, other, new URLSearchParams({ after: p.cursor })))).rejects.toMatchObject({ status: 409 });
            await expect((await service.events(brand, id, new URLSearchParams({ after: 'bad' })))).rejects.toMatchObject({ status: 422 });
        });
        it('A19 current scope and exact original AND message reference apply to internal files and replay', async () => {
            await setup();
            const id = await active(), internal = await upload(id, gsg, 'internal');
            const out = await service.command(gsg, id, { command: 'internal_note', questionId: null, content: content('', [internal.id]), idempotencyKey: randomUUID() });
            await expect((await download.download(brand, internal.id, { kind: 'inquiry', conversationId: id, messageId: out.messageId! }, 'original'))).rejects.toMatchObject({ status: 404 });
            expect(JSON.stringify(await publicDetail(id))).not.toContain(internal.id);
            await expect((await service.command(gsg, id, { command: 'message', kind: 'comment', questionId: null, content: content('', [internal.id]), idempotencyKey: randomUUID() }))).rejects.toMatchObject({ status: 422 });
            const b = content('original'), command = { command: 'message', kind: 'comment', questionId: null, content: b, idempotencyKey: randomUUID() };
            await service.command(brand, id, command);
            await repo.transaction(async (s) => { const m = (await s.list('membership', A)).find(x => x.data.userId === 'user-team')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect((await service.command(brand, id, command))).rejects.toMatchObject({ status: 404 });
            await expect((await service.detail(brand, id))).rejects.toMatchObject({ status: 404 });
            expect((await publicDetail(id, gsg)).messages.some(m => m.body === 'original')).toBe(true);
        });
        it('A20 upload per-item mixed retry, changed payload conflict, late rollback and after-IO revoke preserve only committed bytes', async () => {
            await setup();
            const d = await draft(), id = d.conversationId, key = randomUUID(), item = { clientItemId: key, name: 'proof.png', type: 'image/png', bytes: png };
            const bad = { clientItemId: randomUUID(), name: 'bad.png', type: 'image/png', bytes: Buffer.from('bad') };
            const r = await files.upload(brand, id, [item, bad]);
            expect(r.items.map(i => i.state)).toEqual(['ready', 'failed']);
            expect((await files.upload(brand, id, [item])).items[0]).toEqual(r.items[0]);
            expect(await readdir(dir)).toHaveLength(1);
            expect((await files.upload(brand, id, [{ ...item, name: 'different.png' }])).items[0]).toMatchObject({ state: 'failed', error: { code: 'CONFLICT' } });
            const rows = await repo.list('fileVersion'), names = await readdir(dir);
            const fault = new InquiryFiles(identity, dir, () => { throw Error('late upload'); });
            expect((await fault.upload(brand, id, [{ ...item, clientItemId: randomUUID() }])).items[0].state).toBe('failed');
            expect(await repo.list('fileVersion')).toEqual(rows);
            expect(await readdir(dir)).toEqual(names);
            const revoke = new InquiryFiles(identity, dir, undefined, async () => { await repo.transaction(async (s) => { const m = (await s.list('membership', A)).find(x => x.data.userId === 'user-team')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); }); });
            await expect((await revoke.upload(brand, id, [{ ...item, clientItemId: randomUUID() }]))).rejects.toMatchObject({ status: 404 });
            expect(await readdir(dir)).toEqual(names);
            expect(createHash('sha256').update(await readFile(path.join(dir, names[0]))).digest('hex')).toBe(createHash('sha256').update(png).digest('hex'));
        });
        it('A20 first-send/CAS and duplicate client IDs are atomic with late-fault rollback', async () => {
            await setup();
            const d = await draft(), id = d.conversationId, b = { command: 'publish_first', title: '첫 질문', expectedRevision: d.revision, content: content(), idempotencyKey: randomUUID() }, before = await business();
            await expect((await new InquiryService(identity, () => { throw Error('late command'); }).command(brand, id, b))).rejects.toThrow('late command');
            expect(await business()).toEqual(before);
            const race = await Promise.allSettled([(await service.command(brand, id, b)), (await service.command(brand, id, { ...b, content: content('다른 첫 질문'), idempotencyKey: randomUUID() }))]);
            expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
            expect(await repo.list('inquiryMessage')).toHaveLength(1);
            const send = { command: 'message', kind: 'comment', questionId: null, content: content('두 탭'), idempotencyKey: randomUUID() }, both = await Promise.all([(await service.command(brand, id, send)), (await service.command(brand, id, { ...send, idempotencyKey: randomUUID() }))]);
            expect(both[0]).toEqual(both[1]);
            expect(await repo.list('inquiryMessage')).toHaveLength(2);
            await expect((await service.command(brand, id, { ...send, content: { ...send.content, body: '변경' }, idempotencyKey: randomUUID() }))).rejects.toMatchObject({ status: 409 });
        });
        it('AC09-04 link preserves messages/files and task/submission progress; read duplicate creates one fact', async () => {
            await setup();
            const id = await active(), beforeMessages = await repo.list('inquiryMessage'), task = await repo.get('task', 'task-onboarding');
            const out = await service.command(gsg, id, { command: 'link_task', taskId: 'task-onboarding', expectedRevision: (await publicDetail(id, gsg)).revision, idempotencyKey: randomUUID() });
            expect(out.taskId).toBe('task-onboarding');
            expect(await repo.list('inquiryMessage')).toEqual(beforeMessages);
            expect(await repo.get('task', 'task-onboarding')).toEqual(task);
            expect((await service.list(gsg, new URLSearchParams({ context: A, task: 'task-onboarding' }))).total).toBe(1);
            expect((await publicDetail(id)).history.some(h => h.action === 'task_link')).toBe(true);
            const read = { command: 'read', throughMessageId: beforeMessages[0].id, idempotencyKey: randomUUID() };
            await service.command(gsg, id, read);
            await service.command(gsg, id, { ...read, idempotencyKey: randomUUID() });
            expect(await repo.list('inquiryRead')).toHaveLength(1);
            expect(await repo.list('submission')).toHaveLength(0);
            expect(await repo.list('noticeRead')).toHaveLength(0);
            await expect(repo.transaction(async (s) => { const m = (await s.get('inquiryMessage', beforeMessages[0].id))!; (await s.update('inquiryMessage', m.id, m.revision, m.data)); })).rejects.toBeDefined();
        });
    });
