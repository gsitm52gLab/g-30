import { afterEach, describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository, RecordKind } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { ImportService } from '@/server/imports/service';
import { ImportStaging } from '@/server/imports/staging';
import { ProductService } from '@/server/products/service';
import { parseWorkbook } from '@/server/imports/parser-core';
import { guardedZip } from '@/server/imports/zip';
const A = 'ctx-jp-a-luna', brand = tokenFor('user-luna'), price = tokenFor('user-price'), gsg = tokenFor('user-gsg');
const fields = ['contextKey', 'common.code', 'common.name', 'local.jan', 'retail.amount', 'retail.currency'];
async function xlsx(rows: unknown[][], headers = fields) { const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('상품'); sheet.addRow(headers); for (const row of rows)
    sheet.addRow(row); return Buffer.from(await book.xlsx.writeBuffer()); }
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G07 atomic standard import`, () => {
        let repo: RecordRepository, service: ImportService, products: ProductService, dir: string;
        async function setup() { repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); const identity = await policyFixture(repo); dir = await mkdtemp(path.join(os.tmpdir(), 'gs-hale-g07-import-')); service = new ImportService(identity, new ImportStaging(dir)); products = new ProductService(identity); }
        async function preview(rows: unknown[][], headers = fields, token = brand) { const source = await service.inspect(token, A, 'standard.xlsx', await xlsx(rows, headers)); return service.preview(token, { sourceId: source.sourceId, sheetId: source.sheets[0].id, headerRow: 1, mapping: headers.map((field, i) => ({ column: i + 1, field })), choices: [] }); }
        const business = async () => Promise.all((['product', 'contextProduct', 'productVersion', 'contextProductVersion', 'retailPrice', 'retailPriceVersion', 'internalPrice', 'internalPriceVersion', 'audit', 'domainEvent', 'commandReceipt', 'importBatch', 'submission', 'productUseSnapshot'] as RecordKind[]).map(k => repo.list(k)));
        afterEach(async () => { repo?.close(); if (dir)
            await rm(dir, { recursive: true, force: true }); });
        it('AC07-03 preview writes no business rows; exact 0/leading zeros survive atomic apply and response-loss retry', async () => {
            await setup();
            const before = await business(), p = await preview([[A, '000-NEW', '신규 상품', '00001234', '0', 'JPY'], [A, 'SECOND', '두 번째', '', '19.0001', 'USD']]);
            expect(p.canApply).toBe(true);
            expect(await business()).toEqual(before);
            const command = { previewId: p.id, idempotencyKey: randomUUID() }, result = await service.apply(brand, command);
            expect(await service.apply(brand, command)).toEqual(result);
            expect(await repo.list('importBatch')).toHaveLength(1);
            const batch = await service.batch(brand, result.ids[0]);
            expect(batch.rows).toHaveLength(2);
            const d = await products.detail(brand, batch.rows[0].productId!, A);
            expect(d.common.code).toBe('000-NEW');
            expect(d.local.jan).toBe('00001234');
            expect(d.retail.current!.fields.amount).toBe('0');
            await expect(service.apply(brand, { ...command, previewId: 'different' })).rejects.toBeDefined();
        });
        it('AC07-03 invalid row including skipped duplicate blocks whole batch; forbidden context/numeric identifier explicit', async () => {
            await setup();
            const before = await business(), p = await preview([[A, ' Dup ', 'one', '', '1', 'JPY'], [A, 'dup', 'two', 123, '2', 'JPY'], ['ctx-jp-a-wave', 'OTHER', 'other', '', '3', 'JPY']]);
            expect(p.errorRows).toBe(3);
            expect(p.rows[0].errors.some(e => e.code === 'DUPLICATE_CODE')).toBe(true);
            expect(p.rows[1].errors.some(e => e.field === 'local.jan')).toBe(true);
            await expect(service.apply(brand, { previewId: p.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'IMPORT_ERRORS' });
            expect(await business()).toEqual(before);
        });
        it('AC07-03 injected late exception rolls back all versions/audit/result/receipt; CAS is fresh', async () => {
            await setup();
            const p = await preview([[A, 'ONE', 'one', '', '1', 'JPY'], [A, 'TWO', 'two', '', '2', 'JPY']]), before = await business();
            const faulty = new ImportService(service.identity, service.staging, row => { if (row === 3)
                throw new Error('late batch failure'); });
            await expect(faulty.apply(brand, { previewId: p.id, idempotencyKey: randomUUID() })).rejects.toThrow('late batch failure');
            expect(await business()).toEqual(before);
            const current = await products.detail(brand, 'product-serum', A), update = await preview([[A, current.common.code, 'Excel update', '', '', '']]);
            await products.command(brand, current.productId, { contextId: A, command: 'save_common', common: { ...current.common, name: 'concurrent' }, expectedCommonRevision: current.commonRevision, idempotencyKey: randomUUID() });
            await expect(service.apply(brand, { previewId: update.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' });
            expect(await repo.list('importBatch')).toHaveLength(0);
        });
        it('AC07-04 private mapping denied before preview; price-authorized import supported, public export ZIP omits private field/value', async () => {
            await setup();
            const headers = ['contextKey', 'common.code', 'common.name', 'internal.supplyAmount', 'internal.currency'];
            await expect(preview([[A, 'PRIVATE', 'private', '99123.456', 'JPY']], headers, brand)).rejects.toMatchObject({ status: 403 });
            await expect(preview([[A, 'PRIVATE', 'private', '99123.456', 'JPY']], headers, gsg)).rejects.toMatchObject({ status: 403 });
            const p = await preview([[A, 'PRIVATE', 'private', '99123.456', 'JPY']], headers, price);
            expect(p.canApply).toBe(true);
            await service.apply(price, { previewId: p.id, idempotencyKey: randomUUID() });
            const bytes = await service.workbook(brand, A, 'export'), files = await guardedZip(bytes), xml = [...files.values()].map(b => b.toString('utf8')).join('');
            expect(xml).not.toContain('99123.456');
            expect(xml).not.toContain('internal.supplyAmount');
            expect(xml).toContain('retail.amount');
            await expect(service.workbook(brand, A, 'export', true)).rejects.toMatchObject({ status: 404 });
        });
    });
describe('G07 bounded XLSX parser', () => {
    it('visible sheets/header/rich text and literal formula-like strings retained; formula cached result rejected', async () => {
        const b = new ExcelJS.Workbook(), s = b.addWorksheet('visible');
        s.addRow(['안내']);
        s.addRow(fields);
        s.addRow([A, '=literal', 'name', '0001', { formula: '1+2', result: 3 }, 'JPY']);
        s.getRow(3).hidden = true;
        b.addWorksheet('hidden', { state: 'hidden' }).addRow(['PRIVATE_CANARY']);
        const parsed = await parseWorkbook(Buffer.from(await b.xlsx.writeBuffer()));
        expect(parsed.sheets).toHaveLength(1);
        expect(parsed.omittedHiddenSheets).toBe(1);
        expect(parsed.sheets[0].rows[2].hidden).toBe(true);
        expect(parsed.sheets[0].rows[2].cells[1].text).toBe('=literal');
        expect(parsed.sheets[0].rows[2].cells[4].error).toBe('FORMULA_UNSUPPORTED');
    });
    it('export of formula-looking data never creates formulas', async () => { const bytes = await xlsx([[A, '=literal', '+SUM(1,2)', '@text', '-1', 'JPY']]); const xml = [...(await guardedZip(bytes)).entries()].filter(([k]) => k.startsWith('xl/worksheets/')).map(([, v]) => v.toString('utf8')).join(''); expect(xml).not.toMatch(/<f\b/); });
});
