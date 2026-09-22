import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RecordRepository, UnitOfWork, RecordKind } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { IdentityService } from '@/server/auth/service';
import { SearchService } from '@/server/search/service';
import { AuditService } from '@/server/audit/service';
import { ProductService } from '@/server/products/service';
import { TaskService } from '@/server/tasks/service';
import { InquiryService } from '@/server/inquiries/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankInternalPrice } from '@/domain/products/types';
import { searchQuery } from '@/domain/search/query';
const A = 'ctx-jp-a-luna', B = 'ctx-jp-b-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna'), team = tokenFor('user-team'), gsg = tokenFor('user-gsg'), price = tokenFor('user-price');
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G14 projected search and audit`, () => {
        let repo: RecordRepository, identity: IdentityService, search: SearchService, audit: AuditService, products: ProductService, now = NOW;
        async function setup() { now = NOW; repo = mode === 'mock' ? createMockRepository(() => now) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => now); })(); await policyFixture(repo); identity = new IdentityService(repo, () => now); search = new SearchService(identity); audit = new AuditService(identity); products = new ProductService(identity); }
        const query = (v: Record<string, string> = {}) => new URLSearchParams({ context: A, ...v });
        const create = async (name: string, contextId = A) => (await products.create(admin, { contextId, brandId: 'brand-luna', common: { name, code: randomUUID() }, idempotencyKey: randomUUID() })).ids[0];
        afterEach(() => repo?.close());
        it('AC14-01 SA55 projection precedes literal match/count/order/pages; foreign rows and unknown extra cannot affect visible three hits', async () => {
            await setup();
            for (let i = 0; i < 3; i++)
                await create('VISIBLE-UNIQUE ' + i);
            const before = await search.list(team, query({ q: 'VISIBLE-UNIQUE', kind: 'product', pageSize: '2' }));
            expect(before.total).toBe(3);
            for (let i = 0; i < 2; i++)
                await create('VISIBLE-UNIQUE FOREIGN ' + i, B);
            const after = await search.list(team, query({ q: 'VISIBLE-UNIQUE', kind: 'product', pageSize: '2' }));
            expect(after).toEqual(before);
            expect(after.items).toHaveLength(2);
            expect((await search.list(team, query({ q: 'G02_PRIVATE_CANARY' }))).total).toBe(0);
            await expect(search.list(team, new URLSearchParams({ context: B, q: 'FOREIGN' }))).rejects.toMatchObject({ status: 404 });
        });
        it('A19 nonprice GSG sees no private-price-only audit existence or filter/count/order changes', async () => { await setup(); const id = await create('PRICE-GUARD'); const before = await audit.list(gsg, query()); await products.command(price, id, { contextId: A, command: 'save_internal', expectedPriceRevision: 0, price: { ...blankInternalPrice(), supplyAmount: '923456789', currency: 'JPY', source: 'PRIVATE_PRICE_MARKER' }, idempotencyKey: randomUUID() }); expect(await audit.list(gsg, query())).toEqual(before); expect((await search.list(gsg, query({ q: 'PRIVATE_PRICE_MARKER' }))).total).toBe(0); expect((await search.list(price, query({ q: 'PRIVATE_PRICE_MARKER' }))).total).toBe(1); expect((await audit.list(price, query())).items.some(i => i.action === 'product.save_internal')).toBe(true); });
        it('SA55 same-context other initiator inquiry is absent including body, actor and counts', async () => { await setup(); const inquiries = new InquiryService(identity), draft = await inquiries.createDraft(brand, { contextId: A, taskId: null, idempotencyKey: randomUUID() }); await inquiries.command(brand, draft.conversationId, { command: 'publish_first', expectedRevision: 1, title: 'PRIVATE_OWN_QUESTION', content: { clientMessageId: randomUUID(), body: 'PRIVATE_OWN_BODY', fileVersionIds: [] }, idempotencyKey: randomUUID() }); expect((await search.list(brand, query({ q: 'PRIVATE_OWN_BODY' }))).total).toBe(1); expect((await search.list(team, query({ q: 'PRIVATE_OWN_BODY' }))).total).toBe(0); await expect(search.detail(team, A, 'conversation', draft.conversationId)).rejects.toMatchObject({ status: 404 }); });
        it('AC14-04 six-month actual task/product writer history retains exact old content and changed actor', async () => {
            await setup();
            now = '2026-02-01T12:00:00.000Z';
            const id = await create('OLD_SIX_MONTH_PRODUCT'), tasks = new TaskService(identity), content = { ...blankContent(), title: 'OLD_SIX_MONTH_TASK', description: 'OLD_BODY', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: 'old answer' }] };
            const tid = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [id] }], content, category: 'spot', idempotencyKey: randomUUID() })).ids[0];
            await tasks.command(admin, tid, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
            now = NOW;
            const p = await products.detail(brand, id, A);
            await products.command(brand, id, { contextId: A, command: 'save_common', expectedCommonRevision: p.commonRevision, common: { ...p.common, name: 'NEW_PRODUCT' }, idempotencyKey: randomUUID() });
            const t = (await repo.get('task', tid))!;
            await tasks.command(admin, tid, { command: 'save', expectedRevision: t.revision, content: { ...content, title: 'NEW_TASK', description: 'NEW_BODY' }, idempotencyKey: randomUUID() });
            await tasks.command(admin, tid, { command: 'publish', expectedRevision: (await repo.get('task', tid))!.revision, idempotencyKey: randomUUID() });
            const found = await search.list(brand, query({ q: 'OLD_SIX_MONTH', mode: 'history', to: '2026-02-02' }));
            expect(found.items.some(x => x.sourceKind === 'requestVersion')).toBe(true);
            expect(found.items.some(x => x.sourceKind === 'productVersion')).toBe(true);
            for (const x of found.items) {
                const exact = await search.detail(brand, A, x.sourceKind, x.sourceId);
                expect(exact.item.actor.label).not.toBe('');
                expect(JSON.stringify(exact)).not.toContain('NEW_BODY');
                expect(exact.item.occurredAt).toBe('2026-02-01T12:00:00.000Z');
            }
            expect((await search.list(brand, query({ q: 'OLD_SIX_MONTH', mode: 'current' }))).total).toBe(0);
        });
        it('AC14-04 inactive and reassigned author keeps stored identifier without guessed historical name', async () => { await setup(); const id = await create('AUTHOR HISTORY'), version = (await repo.get('product', id))!.data.currentVersionId!, event = (await repo.list('audit')).find(r => r.data.targetId === id)!; await repo.transaction(async (s) => { const u = (await s.get('user', 'user-admin'))!; (await s.update('user', u.id, u.revision, { ...u.data, status: 'suspended' })); }); const read = await search.detail(brand, A, 'productVersion', version); expect(read.item.actor).toEqual({ id: 'user-admin', label: '이전 작성자' }); const events = await audit.list(gsg, query({ actor: 'user-admin' })); expect(events.items.find(x => x.id === event.id)?.actor).toEqual({ id: 'user-admin', label: '이전 작성자' }); expect((await repo.get('audit', event.id))!.data.actorId).toBe('user-admin'); expect((await repo.get('productVersion', version))!.data.changedBy).toBe('user-admin'); });
        it('SA55 current assignee keyword/filter is separate from immutable changed actor', async () => { await setup(); const tasks = new TaskService(identity), content = { ...blankContent(), title: 'ASSIGNMENT_CURRENT_TASK', description: '업무', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '답변' }] }; const tid = (await tasks.create(admin, { category: 'spot', content, targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: [] }], idempotencyKey: randomUUID() })).ids[0]; await tasks.command(admin, tid, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }); const co = (await repo.get('user', 'user-co'))!; expect((await search.list(brand, query({ q: co.data.name, task: tid }))).total).toBeGreaterThan(0); expect((await search.list(brand, query({ assignee: 'user-co', task: tid }))).total).toBeGreaterThan(0); expect((await search.list(brand, query({ actor: 'user-co', task: tid, mode: 'history' }))).total).toBe(0); await tasks.command(admin, tid, { command: 'assign', expectedRevision: (await repo.get('task', tid))!.revision, assignment: { ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [] }, idempotencyKey: randomUUID() }); expect((await search.list(brand, query({ assignee: 'user-co', task: tid, mode: 'history' }))).total).toBe(0); expect((await search.list(brand, query({ actor: 'user-admin', task: tid, mode: 'history' }))).total).toBeGreaterThan(0); });
        it('AC14-03 replay shares exact persisted receipt operation; failed mutation rolls back audit and subsequent operation scope is clean', async () => { await setup(); const cmd = { contextId: A, brandId: 'brand-luna', common: { name: 'REPLAY', code: randomUUID() }, idempotencyKey: randomUUID() }; const first = await products.create(brand, cmd); expect(await products.create(brand, cmd)).toEqual(first); const rows = (await repo.list('audit')).filter(a => a.data.targetId === first.ids[0]); expect(rows).toHaveLength(1); const d = rows[0].data.detail!; expect(d.receiptId).toBe(d.operationId); expect(await repo.get('commandReceipt', d.receiptId!)).not.toBeNull(); expect(d.references.filter(x => x.role === 'after').map(x => x.kind)).toEqual(expect.arrayContaining(['productVersion', 'contextProductVersion'])); const before = await repo.list('audit'); await expect(new ProductService(identity, () => { throw Error('late_fault'); }).create(brand, { ...cmd, idempotencyKey: randomUUID(), common: { name: 'FAIL', code: randomUUID() } })).rejects.toThrow('late_fault'); expect(await repo.list('audit')).toEqual(before); const next = await create('NEXT'); expect((await repo.list('audit')).find(r => r.data.targetId === next)!.data.detail!.operationId).not.toBe(d.operationId); });
        it('AC14-02 stale product revision conflicts and caller intent can be reapplied explicitly', async () => { await setup(); const id = await create('CAS'), d = await products.detail(brand, id, A), base = { contextId: A, command: 'save_common', expectedCommonRevision: d.commonRevision }; const result = await Promise.allSettled(['ONE', 'TWO'].map(async (name) => products.command(brand, id, { ...base, common: { ...d.common, name }, idempotencyKey: randomUUID() }))); expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(result.filter(r => r.status === 'rejected')).toHaveLength(1); const latest = await products.detail(brand, id, A); await products.command(brand, id, { ...base, expectedCommonRevision: latest.commonRevision, common: { ...d.common, name: 'REAPPLIED' }, idempotencyKey: randomUUID() }); expect((await search.list(brand, query({ q: 'REAPPLIED' }))).total).toBe(1); });
        it('A19 malformed known scalar is503; unknown extras never match or rewrite; audit append-only both adapters', async () => {
            await setup();
            const id = await create('SAFE'), version = (await repo.get('product', id))!.data.currentVersionId!;
            const original = (await repo.get('productVersion', version))!;
            const wrapped: RecordRepository = { ...repo, transaction: fn => repo.transaction(s => fn(new Proxy(s, { get(target, key: keyof UnitOfWork) {
                        if (key === 'list')
                            return async (kind: RecordKind, context?: string) => (await target.list(kind, context)).map(row => row.kind === 'productVersion' && row.id === version ? { ...row, data: { ...original.data, common: { ...original.data.common, name: { canary: 'BAD_SCALAR' } } } } : row);
                        return target[key];
                    } }) as UnitOfWork)) };
            await expect(new SearchService(new IdentityService(wrapped, () => now)).list(brand, query())).rejects.toMatchObject({ status: 503 });
            expect(await repo.get('productVersion', version)).toEqual(original);
            const row = (await repo.list('audit')).find(r => r.data.targetId === id)!;
            await expect(repo.transaction(async (s) => (await s.update('audit', row.id, row.revision, row.data)))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
        });
        it('query rejects nonfinite/repeated/unknown inputs; literal metacharacters and read endpoints leave notification/read rows unchanged', async () => {
            await setup();
            for (const q of [query({ page: 'Infinity' }), query({ page: '1.5' }), new URLSearchParams('context=' + A + '&q=a&q=b'), query({ unknown: 'x' })])
                expect(() => searchQuery(q)).toThrow();
            const before = await Promise.all((['notification', 'notificationReceipt', 'noticeRead', 'taskActivity'] as const).map(k => repo.list(k)));
            expect((await search.list(brand, query({ q: '[.*]' }))).total).toBe(0);
            await search.contexts(brand);
            expect(await Promise.all((['notification', 'notificationReceipt', 'noticeRead', 'taskActivity'] as const).map(k => repo.list(k)))).toEqual(before);
            await expect(audit.list(brand, query())).rejects.toMatchObject({ status: 404 });
        });
    });
