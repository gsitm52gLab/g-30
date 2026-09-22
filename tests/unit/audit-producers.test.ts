import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { RecordRepository, AuditData } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import type { IdentityService } from '@/server/auth/service';
import { SearchService } from '@/server/search/service';
import { auditOperation, appendAudit } from '@/server/audit/writer';
import { AuditService } from '@/server/audit/service';
import { ProductService } from '@/server/products/service';
import { NoticeService } from '@/server/notices/service';
import { FileService } from '@/server/files/service';
import { CompletionService } from '@/server/completion/service';
import { ImportService } from '@/server/imports/service';
import { ImportStaging } from '@/server/imports/staging';
import { blankNotice } from '@/domain/notices/types';
import { blankFileBinding } from '@/domain/products/types';
import { createCompletionTask, completionSubmission, png } from '../fixtures/completion';
const A = 'ctx-jp-a-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna'), gsg = tokenFor('user-gsg'), price = tokenFor('user-price');
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G14 audit actual source closure`, () => {
        let repo: RecordRepository, id: IdentityService, dir: string;
        async function setup() { repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); id = await policyFixture(repo); dir = await mkdtemp(path.join(os.tmpdir(), 'g14-source-')); }
        afterEach(async () => {
            await repo?.close();
            if (dir)
                await rm(dir, { recursive: true, force: true });
        });
        it('AC14-03 async operation scope survives awaits, restores nested scopes and clears failures', async () => {
            await setup();
            const actor = { user: (await repo.get('user', 'user-admin'))! };
            const create = (s: Parameters<typeof appendAudit>[0], label: string) => appendAudit(s, actor, () => NOW, A, 'context.scope_probe', A, {}, { title: label });
            await repo.transaction(async s => {
                await auditOperation(s, 'outer-scope', async () => {
                    await Promise.resolve(); await create(s, 'outer-before');
                    await auditOperation(s, 'inner-scope', async () => { await Promise.resolve(); await create(s, 'inner'); });
                    await create(s, 'outer-after');
                });
                try { await auditOperation(s, 'failed-scope', async () => { await Promise.resolve(); throw new Error('synthetic scope failure'); }); } catch { /* no store mutation */ }
                await create(s, 'after-failure');
            });
            const rows = (await repo.list('audit')).filter(r => r.data.action === 'context.scope_probe');
            const receipt = (label: string) => rows.find(r => r.data.after.title === label)!.data.detail!.receiptId;
            expect(receipt('outer-before')).toBe('outer-scope'); expect(receipt('inner')).toBe('inner-scope');
            expect(receipt('outer-after')).toBe('outer-scope'); expect(receipt('after-failure')).toBeNull();
            const before = await repo.list('audit');
            await expect(repo.transaction(s => auditOperation(s, 'rolled-back', async () => { await create(s, 'rollback'); throw new Error('synthetic rollback'); }))).rejects.toThrow('synthetic rollback');
            expect(await repo.list('audit')).toEqual(before);
        });
        it('AC14-03 actual publish/submit/complete/external events carry exact receipt+event refs, single replay and immutable sources', async () => {
            await setup();
            const taskId = await createCompletionTask(id), source = await completionSubmission(id, dir, taskId), service = new CompletionService(id), w = await service.workspace(admin, taskId), complete = { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() };
            const result = await service.command(admin, complete);
            expect(await service.command(admin, complete)).toEqual(result);
            const external = { command: 'record_external', taskId, expectedTaskRevision: (await repo.get('task', taskId))!.revision, idempotencyKey: randomUUID(), action: { purpose: 'review_request', destination: '합성 외부 기관', requester: { kind: 'user', userId: 'user-luna' }, performer: { kind: 'external', label: '합성 수행자', source: '원문' }, source: { requestId: source.requestId, submissionId: source.submissionId, submissionContentHash: source.submissionContentHash, fileVersionIds: source.fileVersionIds, productUseIds: source.productUseIds }, observedAt: { value: '2026-09-21', precision: 'date', timezone: 'Asia/Tokyo', source: '기록' }, evidenceFileVersionIds: [], latestProgress: '응답 대기', waitingExternal: true, visibility: 'public' } };
            expect(await service.command(admin, external)).toEqual(await service.command(admin, external));
            for (const action of ['task.published', 'submission.created', 'task.manually_completed', 'external.action_recorded']) {
                const rows = (await repo.list('audit')).filter(r => r.data.action === action && r.data.targetId === taskId);
                expect(rows).toHaveLength(1);
                const detail = rows[0].data.detail!;
                expect(await repo.get('commandReceipt', detail.receiptId!)).not.toBeNull();
                expect(detail.references.some(r => r.kind === 'domainEvent')).toBe(true);
                const shown = await new AuditService(id).detail(admin, A, rows[0].id);
                expect(shown.sourcePrecision).toBe('exact');
                expect(shown.versions.length).toBeGreaterThan(0);
                expect(shown.eventIds.length).toBeGreaterThan(0);
            }
            const hit = await new SearchService(id).detail(brand, A, 'submission', source.submissionId);
            expect(hit.item.sourcePrecision).toBe('exact_version');
            expect(hit.fields.some(f => f.value === '실제 부분 제출')).toBe(true);
        });
        it('AC14-03 private import row+batch audit is wholly absent to nonprice GSG, same batch replay retains one receipt operation', async () => { await setup(); const service = new ImportService(id, new ImportStaging(dir)), book = new ExcelJS.Workbook(), sheet = book.addWorksheet('합성'), keys = ['contextKey', 'common.code', 'common.name', 'internal.supplyAmount', 'internal.currency']; sheet.addRow(keys); sheet.addRow([A, 'G14-PRIVATE-IMPORT', 'PRIVATE_IMPORT_CANARY', '1200', 'JPY']); const upload = await service.inspect(price, A, 'PRIVATE_IMPORT_FILE.xlsx', Buffer.from(await book.xlsx.writeBuffer())), preview = await service.preview(price, { sourceId: upload.sourceId, sheetId: upload.sheets[0].id, headerRow: 1, mapping: keys.map((field, i) => ({ column: i + 1, field })), choices: [] }); expect(preview.canApply).toBe(true); const audit = new AuditService(id), query = new URLSearchParams({ context: A }), before = await audit.list(gsg, query), cmd = { previewId: preview.id, idempotencyKey: randomUUID() }, result = await service.apply(price, cmd); expect(await service.apply(price, cmd)).toEqual(result); const after = await audit.list(gsg, query); expect(after).toEqual(before); const rows = (await repo.list('audit')).filter(r => r.data.action === 'product.import' || r.data.action === 'import.applied'); expect(rows).toHaveLength(2); expect(new Set(rows.map(r => r.data.detail!.operationId)).size).toBe(1); expect(rows.every(r => r.data.detail!.sensitivity === 'internal_price')).toBe(true); expect((await audit.list(price, query)).items.filter(r => ['product.import', 'import.applied'].includes(r.action))).toHaveLength(2); expect((await new SearchService(id).list(gsg, new URLSearchParams({ context: A, kind: 'import', q: 'PRIVATE_IMPORT' }))).total).toBe(0); });
        it('A19 original notice audience revocation removes referenced filename from product/history while product stays readable', async () => { await setup(); const notices = new NoticeService(id), files = new FileService(id, dir), products = new ProductService(id), search = new SearchService(id), content = { ...blankNotice(), title: 'File owner notice', body: 'public body' }; const n = (await notices.create(admin, { contextId: A, content, idempotencyKey: randomUUID() })).ids[0]; const file = (await files.upload(admin, { kind: 'notice', noticeId: n }, [{ name: 'EXACT_ORIGIN_FILENAME.png', type: 'image/png', bytes: png }], 'public')).files[0]; const save = async (c: typeof content) => notices.command(admin, n, { command: 'save', content: c, expectedRevision: (await repo.get('notice', n))!.revision, idempotencyKey: randomUUID() }); const publish = async () => notices.command(admin, n, { command: 'publish', expectedRevision: (await repo.get('notice', n))!.revision, idempotencyKey: randomUUID() }); await save({ ...content, fileIds: [file.id] }); await publish(); const pid = (await products.create(brand, { contextId: A, brandId: 'brand-luna', common: { name: 'VISIBLE PRODUCT', code: 'G14-FILE' }, idempotencyKey: randomUUID() })).ids[0], pd = await products.detail(brand, pid, A); await products.command(brand, pid, { contextId: A, command: 'save_files', expectedContextRevision: pd.contextRevision, files: [blankFileBinding('binding', file.id)], idempotencyKey: randomUUID() }); const q = new URLSearchParams({ context: A, q: 'EXACT_ORIGIN_FILENAME', mode: 'history' }); expect((await search.list(brand, q)).total).toBeGreaterThan(0); const before = await repo.get('fileVersion', file.id); await save({ ...content, audience: { mode: 'selected', userIds: [] }, fileIds: [file.id] }); await publish(); expect((await search.list(brand, q)).total).toBe(0); expect((await products.detail(brand, pid, A)).productId).toBe(pid); expect(await repo.get('fileVersion', file.id)).toEqual(before); });
        it('A19 stored metadata scalar fault503 and unknown extension positive preserve original bytes', async () => { await setup(); const pid = (await new ProductService(id).create(brand, { contextId: A, brandId: 'brand-luna', common: { name: 'SAFE AUDIT', code: 'G14-SAFE' }, idempotencyKey: randomUUID() })).ids[0], base = (await repo.list('audit')).find(r => r.data.targetId === pid)!, good = randomUUID(), bad = randomUUID(); await repo.transaction(async (s) => (await s.create('audit', { id: good, contextId: A, data: { ...base.data, extra: 'AUDIT_CANARY', detail: { ...base.data.detail!, extra: { token: 'AUDIT_CANARY' } } } as AuditData }))); const original = await repo.get('audit', good); expect(JSON.stringify(await new AuditService(id).detail(admin, A, good))).not.toContain('AUDIT_CANARY'); expect(await repo.get('audit', good)).toEqual(original); await repo.transaction(async (s) => (await s.create('audit', { id: bad, contextId: A, data: { ...base.data, detail: { ...base.data.detail!, changes: [{ key: 'name', before: null, after: { secret: 'BAD' } }] } } as unknown as AuditData }))); await expect(new AuditService(id).detail(admin, A, bad)).rejects.toMatchObject({ status: 503 }); expect((await repo.get('audit', bad))!.data.detail!.changes[0].after).toEqual({ secret: 'BAD' }); });
    });
