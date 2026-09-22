import { it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { IdentityService } from '@/server/auth/service';
import { seed } from '@/server/db/seed';
import { FileService } from '@/server/files/service';
import { ProductService } from '@/server/products/service';
import { EvidenceService } from '@/server/evidence/service';
import { NoticeService } from '@/server/notices/service';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { blankNotice } from '@/domain/notices/types';
import { blankFileBinding } from '@/domain/products/types';
import { blankEvidenceMetadata } from '@/domain/evidence/types';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
const contextId = 'ctx-jp-a-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
it('A20 D10 populated accepted seven migrations keep real G05/G06/G07/G08 histories and file bytes when missing inquiries/corrections/campaigns are added', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hale-g12-migrate-')), sql = path.resolve('src/server/db/migrations'), prior = path.join(dir, 'prior'), database = path.join(dir, 'source.db');
    await mkdir(prior);
    const oldNames = (await readdir(sql)).filter(n => Number(n.slice(0, 4)) <= 7).sort();
    expect(oldNames).toHaveLength(7);
    for (const n of oldNames)
        await copyFile(path.join(sql, n), path.join(prior, n));
    const db = openDatabase(database, true);
    expect(migrate(db, prior)).toEqual({ applied: 7, total: 7 });
    let repo = createSqliteRepository(db, () => NOW);
    try {
        const identity = await policyFixture(repo), files = new FileService(identity, path.join(dir, 'files')), products = new ProductService(identity);
        const f = (await files.upload(brand, { kind: 'product', productId: 'product-serum', contextId }, [{ name: 'preserved.png', type: 'image/png', bytes: png }], 'public')).files[0], p = await products.detail(brand, 'product-serum', contextId), binding = blankFileBinding(randomUUID(), f.id);
        await products.command(brand, p.productId, { command: 'save_files', contextId, expectedContextRevision: p.contextRevision, files: [binding], idempotencyKey: randomUUID() });
        await products.command(brand, p.productId, { command: 'save_common', contextId, expectedCommonRevision: p.commonRevision, common: { ...p.common, name: '과거 편집 상품' }, idempotencyKey: randomUUID() });
        const current = await products.detail(brand, p.productId, contextId);
        const evidence = new EvidenceService(identity), eid = (await evidence.register(brand, { contextId, source: { kind: 'product_binding', productId: p.productId, contextProductId: current.contextProductId, contextVersionId: current.contextVersionId, bindingId: binding.id, fileVersionId: f.id }, metadata: { ...blankEvidenceMetadata(), title: '과거 자료', documentType: 'product_introduction' }, productIds: [p.productId], idempotencyKey: randomUUID() })).ids[0];
        expect((await evidence.detail(brand, eid)).current.links).toHaveLength(1);
        const notices = new NoticeService(identity), nid = (await notices.create(admin, { contextId, content: { ...blankNotice(), title: '과거 공지', body: '원문 보존', fileIds: [f.id] }, idempotencyKey: randomUUID() })).ids[0], nv = (await notices.command(admin, nid, { command: 'publish', expectedRevision: (await repo.get('notice', nid))!.revision, idempotencyKey: randomUUID() })).ids[1];
        await notices.command(brand, nid, { command: 'read', versionId: nv, idempotencyKey: randomUUID() });
        const tasks = new TaskService(identity), sub = new SubmissionService(identity), c = { ...blankContent(), title: '과거 실제 제출', description: '합성', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '이전 답변' }] }, tid = (await tasks.create(admin, { category: 'spot', content: c, targets: [{ contextId, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], idempotencyKey: randomUUID() })).ids[0];
        await tasks.command(admin, tid, { command: 'publish', expectedRevision: (await repo.get('task', tid))!.revision, idempotencyKey: randomUUID() });
        const w = await sub.workspace(brand, tid), upload = (await new SubmissionFiles(identity, path.join(dir, 'files')).upload(brand, tid, w.request.id, [{ clientItemId: randomUUID(), name: 'old.png', type: 'image/png', bytes: png }])).items[0];
        if (upload.state !== 'ready')
            throw Error('upload fixture');
        await sub.draft(brand, tid, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: '이전 원문' } }], artifacts: [{ fileVersionId: upload.file.id, role: 'evidence', answer: null }] }, idempotencyKey: randomUUID() });
        const sw = await sub.workspace(brand, tid), input = { baseRequestId: sw.request.id, expectedDraftRevision: sw.draft!.revision, expectedTaskRevision: sw.taskRevision, mode: 'full', idempotencyKey: randomUUID() }, result = await sub.submit(brand, tid, input);
        const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all(), oldLedger = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all(), submitted = await sub.snapshot(brand, result.ids[0]);
        (await repo.close());
        const copies: Record<string, string> = {};
        for (const suffix of ['', '-wal', '-shm']) {
            try {
                const raw = await readFile(database + suffix);
                await copyFile(database + suffix, path.join(dir, 'before' + suffix));
                copies[suffix || 'db'] = hash(raw);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        }
        const next = openDatabase(database);
        repo = createSqliteRepository(next, () => NOW);
        expect(migrate(next)).toEqual({ applied: 8, total: 15 });
        expect(next.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        expect((next.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
            name: string;
        }[]).filter(r => oldNames.includes(r.name))).toEqual(oldLedger);
        expect(migrate(next)).toEqual({ applied: 0, total: 15 });
        await seed(repo);
        expect(next.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        const again = new IdentityService(repo, () => NOW);
        expect(await new SubmissionService(again).snapshot(brand, result.ids[0])).toEqual(submitted);
        expect(await new SubmissionService(again).submit(brand, tid, input)).toEqual(result);
        expect((await new FileService(again, path.join(dir, 'files')).download(brand, upload.file.id, tid, 'original')).bytes).toEqual(png);
        for (const k of ['evidenceVersion', 'noticeVersion', 'submission']) {
            const row = next.prepare('SELECT id FROM records WHERE kind=? LIMIT 1').get(k) as {
                id: string;
            };
            expect(() => next.prepare('UPDATE records SET revision=revision+1 WHERE kind=? AND id=?').run(k, row.id)).toThrow();
        }
        console.info('G12_MIGRATION_EVIDENCE ' + JSON.stringify({ oldNames, oldRows: before.length, oldRowsHash: hash(JSON.stringify(before)), historicalByteCopies: copies, oldFileHash: hash(png), oldLedgerHash: hash(JSON.stringify(oldLedger)), repeatApplied: 0, total: 15 }));
    }
    finally {
        (await repo.close());
        await rm(dir, { recursive: true, force: true });
    }
});
