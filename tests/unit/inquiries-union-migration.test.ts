import { it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, readFile, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { IdentityService } from '@/server/auth/service';
import { seed } from '@/server/db/seed';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { FileService } from '@/server/files/service';
import { ProductService } from '@/server/products/service';
import { EvidenceService } from '@/server/evidence/service';
import { ImportService } from '@/server/imports/service';
import { ImportStaging } from '@/server/imports/staging';
import { NoticeService } from '@/server/notices/service';
import { InquiryService } from '@/server/inquiries/service';
import { InquiryFiles } from '@/server/inquiries/files';
import { blankFileBinding } from '@/domain/products/types';
import { blankEvidenceMetadata } from '@/domain/evidence/types';
import { blankNotice } from '@/domain/notices/types';
const contextId = 'ctx-jp-a-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna'), initiator = tokenFor('user-team');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

it.each([6, 8])('populated seven-migration branch gains only 000%i; filesystem copy precedes open and all prior records/files survive', async missing => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'g09-union-')), priorSql = path.join(directory, 'prior-sql');
    const originalDb = path.join(directory, 'original.sqlite'), copyDb = path.join(directory, 'copy.sqlite');
    const originalFiles = path.join(directory, 'original-files'), copiedFiles = path.join(directory, 'copied-files');
    await mkdir(priorSql); await mkdir(originalFiles);
    const source = path.resolve('src/server/db/migrations'), names = (await readdir(source)).filter(x => x.endsWith('.sql')).sort();
    expect(names.map(n => Number(n.slice(0, 4)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const name of names.filter(n => Number(n.slice(0, 4)) !== missing)) await copyFile(path.join(source, name), path.join(priorSql, name));
    let db = openDatabase(originalDb, true);
    expect(migrate(db, priorSql)).toEqual({ applied: 7, total: 7 });
    let repo = createSqliteRepository(db, () => NOW), identity = await policyFixture(repo), filesRoot = originalFiles;
    const productReference = { kind: 'product' as const, contextId, productId: 'product-serum' };
    const productFile = (await new FileService(identity, filesRoot).upload(brand, productReference, [{ name: 'original.png', type: 'image/png', bytes: png }], 'public')).files[0];
    const p = await new ProductService(identity).detail(brand, 'product-serum', contextId), binding = blankFileBinding(randomUUID(), productFile.id);
    await new ProductService(identity).command(brand, p.productId, { command: 'save_files', contextId, expectedContextRevision: p.contextRevision, files: [binding], idempotencyKey: randomUUID() });
    const noticeId = (await new NoticeService(identity).create(admin, { contextId, content: { ...blankNotice(), title: 'Notice retained', body: 'Original notice body', fileIds: [productFile.id] }, idempotencyKey: randomUUID() })).ids[0];
    const noticePublish = { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }, noticeReceipt = await new NoticeService(identity).command(admin, noticeId, noticePublish);
    await new NoticeService(identity).command(brand, noticeId, { command: 'read', versionId: noticeReceipt.ids[1], idempotencyKey: randomUUID() });
    await repo.transaction(s => { const row = s.get('task', 'task-pop')!; s.update('task', row.id, row.revision, { ...row.data, title: 'Original edited task retained' }); });
    const produceEvidence = async () => {
        const products = new ProductService(identity), current = await products.detail(brand, 'product-serum', contextId);
        const evidence = new EvidenceService(identity), eid = (await evidence.register(brand, { contextId, source: { kind: 'product_binding', productId: current.productId, contextProductId: current.contextProductId, contextVersionId: current.contextVersionId, bindingId: binding.id, fileVersionId: productFile.id }, metadata: { ...blankEvidenceMetadata(), title: 'Original evidence', documentType: 'product_introduction' }, productIds: [current.productId], idempotencyKey: randomUUID() })).ids[0];
        const detail = await evidence.detail(admin, eid), link = detail.current.links[0];
        await evidence.command(admin, eid, { command: 'assess', linkId: link.id, expectedLinkRevision: link.revision, status: 'application_confirmed', reason: 'Product relationship only', idempotencyKey: randomUUID() });
        const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Products'); sheet.addRow(['contextKey', 'common.code', 'common.name']); sheet.addRow([contextId, 'UNION-EXACT', 'Imported before migration']);
        const imports = new ImportService(identity, new ImportStaging(path.join(directory, 'staging'))), upload = await imports.inspect(brand, contextId, 'prior.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
        const preview = await imports.preview(brand, { sourceId: upload.sourceId, sheetId: upload.sheets[0].id, headerRow: 1, mapping: ['contextKey', 'common.code', 'common.name'].map((field, i) => ({ column: i + 1, field })), choices: [] });
        expect(preview.canApply).toBe(true); const command = { previewId: preview.id, idempotencyKey: randomUUID() }, result = await imports.apply(brand, command);
        return { replay: () => new ImportService(identity, new ImportStaging(path.join(directory, 'staging'))).apply(brand, command), result };
    };
    const produceInquiry = async () => {
        const service = new InquiryService(identity), draft = await service.createDraft(initiator, { contextId, taskId: null, idempotencyKey: randomUUID() });
        const uploaded = (await new InquiryFiles(identity, filesRoot).upload(initiator, draft.conversationId, [{ clientItemId: randomUUID(), name: 'inquiry.png', type: 'image/png', bytes: png }])).items[0];
        if (uploaded.state !== 'ready') throw Error('real ready file required');
        const command = { command: 'publish_first', expectedRevision: draft.revision, title: 'Original inquiry', content: { clientMessageId: randomUUID(), body: 'Original body', fileVersionIds: [uploaded.file.id] }, idempotencyKey: randomUUID() };
        const result = await service.command(initiator, draft.conversationId, command);
        await service.command(admin, draft.conversationId, { command: 'read', throughMessageId: result.messageId, idempotencyKey: randomUUID() });
        return { replay: () => new InquiryService(identity).command(initiator, draft.conversationId, command), result };
    };
    try {
        const existing = await (missing === 8 ? produceEvidence() : produceInquiry());
        const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all(), oldMigrations = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all();
        repo.close();
        // Never open the prior database to copy it. Record/copy all SQLite sidecars using filesystem bytes first.
        const copies: { source: string; destination: string; sha256: string }[] = [];
        for (const suffix of ['', '-wal', '-shm']) {
            const sourceFile = originalDb + suffix;
            try { const bytes = await readFile(sourceFile); await copyFile(sourceFile, copyDb + suffix); expect(hash(await readFile(copyDb + suffix))).toBe(hash(bytes)); copies.push({ source: sourceFile, destination: copyDb + suffix, sha256: hash(bytes) }); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await cp(originalFiles, copiedFiles, { recursive: true }); filesRoot = copiedFiles;
        const priorFileHashes = await Promise.all((await readdir(originalFiles)).sort().map(async name => ({ name, sha256: hash(await readFile(path.join(originalFiles, name))) })));
        db = openDatabase(copyDb); repo = createSqliteRepository(db, () => NOW); identity = new IdentityService(repo, () => NOW);
        expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        expect(migrate(db)).toEqual({ applied: 1, total: 8 });
        expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        const allMigrations = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as { name: string; sha256: string }[];
        expect(allMigrations.filter(x => Number(x.name.slice(0, 4)) !== missing)).toEqual(oldMigrations);
        for (const m of allMigrations) expect(m.sha256).toBe(hash(await readFile(path.join(source, m.name))));
        expect(migrate(db)).toEqual({ applied: 0, total: 8 }); expect((await seed(repo)).inserted).toBe(0);
        expect(await existing.replay()).toEqual(existing.result);
        expect(await new NoticeService(identity).command(admin, noticeId, noticePublish)).toEqual(noticeReceipt);
        expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        for (const file of priorFileHashes) expect(hash(await readFile(path.join(copiedFiles, file.name)))).toBe(file.sha256);
        for (const copy of copies) expect(hash(await readFile(copy.source))).toBe(copy.sha256);
        await (missing === 8 ? produceInquiry() : produceEvidence());
        for (const kind of ['inquiryMessage', 'inquiryRead', 'noticeVersion', 'noticeRead', 'evidenceVersion', 'evidenceAssessment', 'importBatch']) {
            const row = db.prepare('SELECT id FROM records WHERE kind=? LIMIT 1').get(kind) as { id: string }; expect(row).toBeDefined();
            expect(() => db.prepare('UPDATE records SET revision=revision+1 WHERE kind=? AND id=?').run(kind, row.id)).toThrow();
        }
        console.info('G09_UNION_MIGRATION ' + JSON.stringify({ missing, priorCount: 7, finalCount: 8, preservedRows: before.length, rowsSha256: hash(JSON.stringify(before)), copiedBeforeOpening: copies, originalFilesUnchanged: priorFileHashes, repeatNoop: true, replayUnchanged: true, bothModuleProducersAndGuards: true }));
    } finally { repo.close(); await rm(directory, { recursive: true, force: true }); }
});
