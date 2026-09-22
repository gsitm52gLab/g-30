import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import type { RecordRepository } from '@/domain/records';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import type { IdentityService } from '@/server/auth/service';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { FileService } from '@/server/files/service';
import { ProductService } from '@/server/products/service';
import { blankContent, blankRequirement, requirementTypes } from '@/domain/tasks/types';
import { blankDraft, type AnswerInput, type DraftContent } from '@/domain/submissions/types';
import { evaluateAnswers } from '@/domain/submissions/evaluate';
import { parseAnswerInput } from '@/domain/submissions/validate';
import { blankFileBinding, blankRetailPrice } from '@/domain/products/types';
import { MAX_FILE_BYTES } from '@/domain/files/validate';
const A = 'ctx-jp-a-luna', admin = tokenFor('user-admin'), brand = tokenFor('user-luna'), co = tokenFor('user-co'), team = tokenFor('user-team');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const payload = () => ({ ...blankContent(), title: 'G05 합성 요청', description: '자료를 보내 주세요', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '답변' }] });
// Inspect actual JSON fields and complete numeric values, never substrings of opaque IDs.
const privatePriceKeys = new Set(['internalPrice', 'internalPriceId', 'internalPriceVersion', 'internalPriceVersionId', 'internalPriceVersions', 'internalSupplyPrice', 'internalSupplyRate', 'supplyAmount', 'supplyRate', 'margin', 'marginRate']);
function privatePriceLeaks(value: unknown, at = '$'): string[] {
    if (Array.isArray(value))
        return value.flatMap((entry, index) => privatePriceLeaks(entry, `${at}[${index}]`));
    if (value !== null && typeof value === 'object')
        return Object.entries(value).flatMap(([key, entry]) => [
            ...(privatePriceKeys.has(key) ? [`${at}.${key}: forbidden key`] : []),
            ...privatePriceLeaks(entry, `${at}.${key}`),
        ]);
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value.trim()) : null;
    return numeric === 1700 || numeric === 0.4 ? [`${at}: confidential fixture value`] : [];
}
it('price privacy oracle accepts the exact observed UUID and harmless embedded digit sequences', () => {
    const value = { taskId: '8d170022-a8a6-4895-a90d-cefbdf43ba61', versions: [{ id: 'record-0.4-suffix', label: 'v0.4.2', retailPriceVersionId: 'public-retail-1700-id', amount: '4300' }] };
    expect(privatePriceLeaks(value)).toEqual([]);
});
it('price privacy oracle detects nested private keys and complete numeric/string confidential prices', () => {
    for (const key of ['internalPrice', 'internalPriceVersionId', 'internalSupplyPrice', 'internalSupplyRate', 'margin', 'supplyAmount', 'supplyRate'])
        expect(privatePriceLeaks({ products: [{ nested: { [key]: null } }] })).toContain(`$.products[0].nested.${key}: forbidden key`);
    for (const value of [1700, 0.4, '1700', '0.4', '1700.00', '0.400'])
        expect(privatePriceLeaks({ products: [{ unknown: value }] })).toEqual(['$.products[0].unknown: confidential fixture value']);
});
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G05 actual producer`, async () => {
        let repo: RecordRepository, identity: IdentityService, tasks: TaskService, sub: SubmissionService, dir: string, files: SubmissionFiles, products: ProductService;
        async function setup() { repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); identity = await policyFixture(repo); tasks = new TaskService(identity); sub = new SubmissionService(identity); products = new ProductService(identity); dir = await mkdtemp(path.join(os.tmpdir(), 'gs-hale-g05-')); files = new SubmissionFiles(identity, dir); }
        async function task(c = payload(), productIds: string[] = []) { const id = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds }], content: c, category: 'spot', idempotencyKey: randomUUID() })).ids[0]; await taskCommand(id, 'publish'); return id; }
        async function taskCommand(id: string, command: string, extra: Record<string, unknown> = {}) { return (await tasks.command(admin, id, { command, expectedRevision: (await repo.get('task', id))!.revision, idempotencyKey: randomUUID(), ...extra })); }
        async function save(id: string, content: DraftContent, actor = brand) { const w = await sub.workspace(actor, id); return (await sub.draft(actor, id, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft?.revision ?? 0, content, providedBy: actor === admin ? { kind: 'external_source', label: '합성 제조사', source: '이메일로 받은 합성 자료' } : undefined, idempotencyKey: randomUUID() })); }
        async function textDraft(id: string, text = '답변'): Promise<DraftContent> { const w = await sub.workspace(brand, id); return { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text } }] }; }
        async function submissionInput(id: string, mode: 'partial' | 'full' = 'full') { const w = await sub.workspace(brand, id); return { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode, idempotencyKey: randomUUID() }; }
        async function upload(id: string, name = 'proof.png', clientItemId = randomUUID(), bytes = png) { const w = await sub.workspace(brand, id); return (await files.upload(brand, id, w.request.id, [{ clientItemId, name, type: 'image/png', bytes }])); }
        afterEach(async () => {
            repo?.close();
            if (dir)
                await rm(dir, { recursive: true, force: true });
        });
        it('SA15/16/17 saves incomplete draft, validates before completeness, partial/full are immutable independent from acceptance/completion', async () => {
            await setup();
            const c = payload();
            c.requirements.push({ ...blankRequirement('zero', 'number'), label: '수량' });
            const id = await task(c), draft = await textDraft(id);
            draft.answers.push({ requestId: draft.answers[0].requestId, requirementKey: 'zero', productId: null, type: 'number', input: { value: '-' } });
            await save(id, draft);
            expect((await sub.workspace(brand, id)).draft!.content.answers[1].input).toEqual({ value: '-' });
            await expect((await sub.submit(brand, id, await submissionInput(id, 'partial')))).rejects.toMatchObject({ code: 'INVALID_ANSWERS' });
            draft.answers.pop();
            await save(id, draft);
            expect((await sub.workspace(brand, id)).draftEvaluation!.missing).toBe(1);
            const beforeEvaluation = await repo.list('submissionDraft');
            expect((await sub.evaluate(brand, id, { baseRequestId: draft.answers[0].requestId, content: draft })).evaluation.missing).toBe(1);
            expect(await repo.list('submissionDraft')).toEqual(beforeEvaluation);
            await expect((await sub.submit(brand, id, await submissionInput(id)))).rejects.toMatchObject({ code: 'MISSING_REQUIRED' });
            const first = (await sub.submit(brand, id, await submissionInput(id, 'partial'))).ids[0], v1 = await repo.get('submission', first);
            expect((await repo.get('task', id))!.data.status).toBe('partial');
            expect(await repo.list('taskActivity')).toHaveLength(0);
            draft.answers.push({ requestId: draft.answers[0].requestId, requirementKey: 'zero', productId: null, type: 'number', input: { value: '000.00' } });
            await save(id, draft);
            const second = (await sub.submit(brand, id, await submissionInput(id))).ids[0];
            expect(second).not.toBe(first);
            expect(await repo.get('submission', first)).toEqual(v1);
            expect((await sub.snapshot(brand, second)).content.answers[1].input).toEqual({ value: '0' });
            expect((await repo.get('task', id))!.data.status).toBe('submitted');
            const observer = await sub.workspace(team, id);
            expect(observer.draftEvaluation).toBeNull();
            expect(observer.submittedEvaluation!.evaluation.missing).toBe(0);
            expect((await tasks.catalog(team, A)).tasks.find(t => t.id === id)!.data.submissionSummary!.mode).toBe('full');
            expect((await sub.snapshot(brand, second)).review).toMatchObject({ connected: true, reviews: [], status: 'pending' });
            await expect(repo.transaction(async (s) => { const row = (await s.get('submission', first))!; (await s.update('submission', first, row.revision, row.data)); })).rejects.toMatchObject({ code: 'INVALID_RECORD' });
        });
        it('SA17 CAS races, response loss/new-key retry consume one draft; snapshot/product/audit/outbox/receipt rollback is atomic', async () => {
            await setup();
            const id = await task(payload(), ['product-serum']), draft = await textDraft(id), p = await products.detail(brand, 'product-serum', A);
            draft.productSelections = [{ productId: p.productId, expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }];
            await save(id, draft);
            const input = await submissionInput(id), before = await Promise.all(['submission', 'productUseSnapshot', 'audit', 'domainEvent', 'commandReceipt', 'task'].map(kind => repo.list(kind as 'task')));
            await expect((await new SubmissionService(identity, stage => {
                if (stage === 'submit')
                    throw new Error('injected submit');
            }).submit(brand, id, input))).rejects.toThrow('injected submit');
            expect(await Promise.all(['submission', 'productUseSnapshot', 'audit', 'domainEvent', 'commandReceipt', 'task'].map(kind => repo.list(kind as 'task')))).toEqual(before);
            const results = await Promise.all([(await sub.submit(brand, id, input)), (await sub.submit(brand, id, { ...input, idempotencyKey: randomUUID() }))]);
            expect(results[0]).toEqual(results[1]);
            expect(await repo.list('submission')).toHaveLength(1);
            expect(await sub.submit(brand, id, input)).toEqual(results[0]);
            await expect((await sub.submit(brand, id, { ...input, mode: 'partial' }))).rejects.toMatchObject({ status: 409 });
            const w = await sub.workspace(brand, id), saveInput = { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, content: draft, idempotencyKey: randomUUID() };
            const race = await Promise.allSettled([(await sub.draft(brand, id, saveInput)), (await sub.draft(co, id, { ...saveInput, idempotencyKey: randomUUID() }))]);
            expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        });
        it('D06 actual v1 survives changed request and explicit compatible rebase; old full cannot satisfy new request', async () => {
            await setup();
            const id = await task(), draft = await textDraft(id);
            await save(id, draft);
            const first = (await sub.submit(brand, id, await submissionInput(id))).ids[0], v1 = await repo.get('submission', first);
            const c = payload();
            c.requirements.push({ ...blankRequirement('added'), label: '추가 필수' });
            await taskCommand(id, 'save', { content: c });
            await taskCommand(id, 'publish');
            expect((await repo.get('task', id))!.data.status).toBe('requested');
            expect((await tasks.detail(brand, id)).submissionSummary).toMatchObject({ id: first, isCurrentRequest: false });
            expect((await tasks.detail(brand, id)).requirementStatus.find(r => r.requirementKey === 'added')?.status).toBe('missing');
            await expect((await save(id, draft))).rejects.toMatchObject({ code: 'REQUEST_CHANGED' });
            const preview = await sub.rebasePreview(brand, id), w = await sub.workspace(brand, id);
            await sub.draft(brand, id, { command: 'rebase_apply', baseRequestId: w.draft!.baseRequestId, targetRequestId: preview.currentRequestId, expectedDraftRevision: preview.draftRevision, carryAnswers: [{ requirementKey: 'answer', productId: null }], idempotencyKey: randomUUID() });
            const updated = (await sub.workspace(brand, id)).draft!.content;
            updated.answers.push({ requestId: preview.currentRequestId, requirementKey: 'added', productId: null, type: 'long_text', input: { text: '새 답변' } });
            await save(id, updated);
            await sub.submit(brand, id, await submissionInput(id));
            expect(await repo.get('submission', first)).toEqual(v1);
            expect((await tasks.detail(brand, id)).submissionSummary!.sequence).toBe(2);
        });
        it('SA21 draft file is private until actual submission; picker/binding/capture exact release and fresh revocation deny', async () => {
            await setup();
            const id = await task(), u = (await upload(id)).items[0];
            if (u.state !== 'ready')
                throw new Error('upload failed');
            const fid = u.file.id, fs = new FileService(identity, dir), product = await products.detail(brand, 'product-serum', A), binding = blankFileBinding(randomUUID(), fid);
            await expect((await fs.download(team, fid, id, 'original'))).rejects.toMatchObject({ status: 404 });
            expect((await products.detail(team, 'product-serum', A)).reusableFiles.some(f => f.id === fid)).toBe(false);
            await expect((await products.command(team, 'product-serum', { command: 'save_files', contextId: A, expectedContextRevision: product.contextRevision, files: [binding], idempotencyKey: randomUUID() }))).rejects.toMatchObject({ status: 422 });
            const draft = await textDraft(id);
            draft.artifacts = [{ fileVersionId: fid, role: 'editable_original', answer: null }];
            await save(id, draft);
            expect((await repo.get('task', id))!.data.status).toBe('requested');
            await sub.submit(brand, id, await submissionInput(id));
            expect((await fs.download(team, fid, id, 'original')).bytes).toEqual(png);
            expect((await products.detail(team, 'product-serum', A)).reusableFiles.some(f => f.id === fid)).toBe(true);
            await products.command(team, 'product-serum', { command: 'save_files', contextId: A, expectedContextRevision: product.contextRevision, files: [binding], idempotencyKey: randomUUID() });
            await repo.transaction(async (s) => { const m = (await s.list('membership', A)).find(m => m.data.userId === 'user-team')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect((await fs.download(team, fid, { kind: 'product', productId: 'product-serum', contextId: A }, 'original'))).rejects.toMatchObject({ status: 404 });
        });
        it('SA19 mixed upload retains successes; stable-item retry, 25MiB/10 exact, +1/11 and rollback bytes', async () => {
            await setup();
            const id = await task(), w = await sub.workspace(brand, id), item = randomUUID(), batch = await files.upload(brand, id, w.request.id, [{ clientItemId: item, name: 'good.png', type: 'image/png', bytes: png }, { clientItemId: randomUUID(), name: 'bad.png', type: 'image/png', bytes: Buffer.from('wrong') }]);
            expect(batch.items.map(x => x.state)).toEqual(['ready', 'failed']);
            expect((await files.upload(brand, id, w.request.id, [{ clientItemId: item, name: 'good.png', type: 'image/png', bytes: png }])).items[0]).toEqual(batch.items[0]);
            expect(await repo.list('fileVersion')).toHaveLength(1);
            const exact = Buffer.alloc(MAX_FILE_BYTES, 65);
            exact.set(png);
            expect((await upload(id, 'large.png', randomUUID(), exact)).items[0].state).toBe('ready');
            expect((await upload(id, 'over.png', randomUUID(), Buffer.concat([exact, Buffer.from([0])]))).items[0].state).toBe('failed');
            const ten = Array.from({ length: 10 }, () => ({ clientItemId: randomUUID(), name: 'copy.png', type: 'image/png', bytes: png }));
            expect((await files.upload(brand, id, w.request.id, ten)).items.filter(x => x.state === 'ready')).toHaveLength(10);
            await expect((await files.upload(brand, id, w.request.id, [...ten, ten[0]]))).rejects.toMatchObject({ status: 422 });
            const before = await readdir(dir);
            expect((await new SubmissionFiles(identity, dir, () => { throw new Error('file fault'); }).upload(brand, id, w.request.id, [{ ...ten[0], clientItemId: randomUUID() }])).items[0].state).toBe('failed');
            expect(await readdir(dir)).toEqual(before);
        });
        it('GSG proxy provider/recorder/uploader are distinct; nonassignee/crosscontext deny; paused draft allowed nested resume exact', async () => {
            await setup();
            const id = await task(), draft = await textDraft(id);
            await expect((await save(id, draft, team))).rejects.toMatchObject({ status: 403 });
            await expect((await sub.workspace(tokenFor('user-wave'), id))).rejects.toMatchObject({ status: 404 });
            await expect((await sub.draft(brand, id, { command: 'save', baseRequestId: draft.answers[0].requestId, expectedDraftRevision: 0, content: draft, providedBy: { kind: 'user', userId: 'user-admin' }, idempotencyKey: randomUUID() }))).rejects.toMatchObject({ status: 403 });
            await save(id, draft, admin);
            const first = (await sub.submit(admin, id, await submissionInput(id))).ids[0];
            expect((await sub.snapshot(brand, first))).toMatchObject({ recordedBy: 'user-admin', providedBy: { kind: 'external_source', label: '합성 제조사' } });
            await taskCommand(id, 'hold', { reason: '보류' });
            await taskCommand(id, 'cancel', { reason: '취소' });
            await save(id, { ...draft, narrative: '보류 중 작업' });
            await expect((await sub.submit(brand, id, await submissionInput(id)))).rejects.toMatchObject({ code: 'TASK_PAUSED' });
            await taskCommand(id, 'resume', { reason: '재개' });
            expect((await repo.get('task', id))!.data.status).toBe('submitted');
            await taskCommand(id, 'assign', { assignment: { ownerId: 'user-gsg', assigneeId: 'user-team', coAssigneeIds: [] } });
            await expect((await save(id, draft))).rejects.toMatchObject({ status: 403 });
            expect((await sub.snapshot(team, first)).providedBy).toMatchObject({ kind: 'external_source' });
        });
        it('D09 explicit product revisions/retail/file snapshot survive live edit; no hidden latest replacement or private price refs', async () => {
            await setup();
            const id = await task(payload(), ['product-serum']), d = await textDraft(id), p = await products.detail(brand, 'product-serum', A);
            d.productSelections = [{ productId: p.productId, expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }];
            await save(id, d);
            const first = (await sub.submit(brand, id, await submissionInput(id))).ids[0], v1 = await sub.snapshot(brand, first);
            await products.command(brand, 'product-serum', { command: 'save_common', contextId: A, expectedCommonRevision: p.commonRevision, common: { ...p.common, name: '수정된 현재 상품' }, idempotencyKey: randomUUID() });
            await save(id, { ...d, narrative: 'v2' });
            await expect((await sub.submit(brand, id, await submissionInput(id)))).rejects.toMatchObject({ status: 409 });
            expect(await sub.snapshot(brand, first)).toEqual(v1);
            const refreshed = await products.detail(brand, 'product-serum', A);
            d.productSelections[0].expectedCommonRevision = refreshed.commonRevision;
            await save(id, d);
            const second = (await sub.submit(brand, id, await submissionInput(id))).ids[0];
            expect((await sub.snapshot(brand, second)).products[0].common.name).toBe('수정된 현재 상품');
            expect((await repo.get('product', 'product-serum'))!.data).toMatchObject({ internalSupplyPrice: '1700', internalSupplyRate: '0.4' });
            expect(privatePriceLeaks(v1)).toEqual([]);
        });
        it('actual product-scoped condition ancestry and typed invalid values keep exact denominator without author-provided flags', async () => {
            await setup();
            const c = payload();
            c.requirements = [{ ...blankRequirement('parent', 'choice'), label: '선택', options: ['yes', 'no'], productIds: ['product-serum'] }, { ...blankRequirement('child', 'number'), label: '조건 수량', productIds: ['product-serum'], condition: { key: 'parent', equals: 'yes' } }, { ...blankRequirement('date', 'date'), label: '날짜', required: false }];
            const id = await task(c, ['product-serum']), w = await sub.workspace(brand, id), p = await products.detail(brand, 'product-serum', A);
            const d: DraftContent = { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'parent', productId: 'product-serum', type: 'choice', input: { selected: ['no'] } }, { requestId: w.request.id, requirementKey: 'child', productId: 'product-serum', type: 'number', input: { value: 'invalid stale hidden' } }, { requestId: w.request.id, requirementKey: 'date', productId: null, type: 'date', input: { value: '2026-02-30', precision: 'date', timezone: 'Asia/Seoul' } }], productSelections: [{ productId: 'product-serum', expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }] };
            await save(id, d);
            expect((await sub.workspace(brand, id)).draftEvaluation).toMatchObject({ required: 1, satisfied: 1, invalid: 1 });
            await expect((await sub.submit(brand, id, await submissionInput(id, 'partial')))).rejects.toMatchObject({ code: 'INVALID_ANSWERS' });
            d.answers.pop();
            await save(id, d);
            const submission = (await sub.submit(brand, id, await submissionInput(id))).ids[0];
            expect((await sub.snapshot(brand, submission)).evaluation.items.find(i => i.requirementKey === 'child')?.status).toBe('not_applicable');
            d.answers[0] = { ...d.answers[0], input: { selected: ['yes'] } } as AnswerInput;
            await save(id, d);
            expect((await sub.workspace(brand, id)).draftEvaluation).toMatchObject({ required: 2, invalid: 1 });
            await expect((await sub.draft(brand, id, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: (await sub.workspace(brand, id)).draft!.revision, content: { ...d, answers: [{ ...d.answers[0], productId: null }] }, idempotencyKey: randomUUID() }))).rejects.toMatchObject({ status: 422 });
        });
        it('actual capture uses selected dated retail version rather than future latest and rolls back invalid selection', async () => {
            await setup();
            const id = await task(payload(), ['product-serum']);
            await products.command(brand, 'product-serum', { command: 'save_retail', contextId: A, price: { ...blankRetailPrice(), currency: 'JPY', amount: '0', effectiveFrom: '2026-09-01', effectiveTo: '2026-09-30' }, expectedPriceRevision: 0, idempotencyKey: randomUUID() });
            const first = await products.detail(brand, 'product-serum', A);
            await products.command(brand, 'product-serum', { command: 'save_retail', contextId: A, price: { ...blankRetailPrice(), currency: 'JPY', amount: '999999999999999999999.99', effectiveFrom: '2026-10-01' }, expectedPriceRevision: first.retail.revision, idempotencyKey: randomUUID() });
            const p = await products.detail(brand, 'product-serum', A), d = await textDraft(id);
            d.productSelections = [{ productId: p.productId, expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: [], retailPriceVersionId: p.retail.current!.id, asOfDate: '2026-09-21' }];
            await save(id, d);
            await expect((await sub.submit(brand, id, await submissionInput(id)))).rejects.toMatchObject({ status: 422 });
            expect(await repo.list('submission')).toHaveLength(0);
            expect(await repo.list('productUseSnapshot')).toHaveLength(0);
            d.productSelections[0].retailPriceVersionId = first.retail.current!.id;
            await save(id, d);
            const snapshot = await sub.snapshot(brand, (await sub.submit(brand, id, await submissionInput(id))).ids[0]);
            expect(snapshot.products[0]).toMatchObject({ retailPriceVersionId: first.retail.current!.id, retailPrice: { amount: '0' }, retailSelection: { asOfDate: '2026-09-21', rule: 'explicit_version_within_stated_dates' } });
        });
        it('brand direct known unpublished GSG request file cannot be laundered through submission; preserved request upload DTO', async () => {
            await setup();
            const id = await task(), fs = new FileService(identity, dir), file = (await fs.upload(admin, id, [{ name: 'request.png', type: 'image/png', bytes: png }], 'public')).files[0];
            expect(Object.keys(file).sort()).toEqual(['id', 'name', 'bytes', 'mime', 'sha256', 'preview', 'visibility'].sort());
            const d = await textDraft(id);
            d.artifacts = [{ fileVersionId: file.id, role: 'evidence', answer: null }];
            await expect((await save(id, d))).rejects.toMatchObject({ status: 422 });
            expect((await sub.workspace(brand, id)).availableFiles.some(f => f.id === file.id)).toBe(false);
            await expect((await fs.download(brand, file.id, id, 'original'))).rejects.toMatchObject({ status: 404 });
            await taskCommand(id, 'save', { content: { ...payload(), referenceFileIds: [file.id] } });
            await taskCommand(id, 'publish');
            d.answers[0].requestId = (await sub.workspace(brand, id)).request.id;
            await save(id, d);
            await sub.submit(brand, id, await submissionInput(id));
            expect((await fs.download(team, file.id, id, 'original')).bytes).toEqual(png);
        });
        it('stored malformed nested request values cannot cross evaluation DTO while original record is preserved', async () => {
            await setup();
            const id = await task(), initial = await sub.workspace(brand, id);
            await repo.transaction(async (s) => { const old = (await s.get('requestVersion', initial.request.id))!, task = (await s.get('task', id))!; const data = { ...old.data, sequence: 2, previousId: old.id, content: { ...old.data.content, requirements: old.data.content.requirements.map(q => ({ ...q, label: { private: 'EVALUATION_CANARY' }, productIds: [{ private: 'EVALUATION_CANARY' }] })) } } as unknown as typeof old.data; const next = (await s.create('requestVersion', { id: randomUUID(), contextId: A, data })); (await s.update('task', task.id, task.revision, { ...task.data, currentRequestId: next.id })); });
            const w = await sub.workspace(brand, id);
            expect(JSON.stringify(w)).not.toContain('EVALUATION_CANARY');
            expect(w.draftEvaluation!.canSubmitFull).toBe(false);
            expect(w.draftEvaluation!.invalid).toBeGreaterThan(0);
            await expect((await sub.draft(brand, id, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: blankDraft(), idempotencyKey: randomUUID() }))).rejects.toMatchObject({ code: 'REQUEST_INVALID', status: 409 });
            expect(JSON.stringify((await repo.list('requestVersion')).find(r => r.data.sequence === 2))).toContain('EVALUATION_CANARY');
        });
        it('unknown extra request keys retain legitimate authoritative rules and full submit', async () => {
            await setup();
            const id = await task(), w = await sub.workspace(brand, id);
            await repo.transaction(async (s) => { const old = (await s.get('requestVersion', w.request.id))!, task = (await s.get('task', id))!; const next = (await s.create('requestVersion', { id: randomUUID(), contextId: A, data: { ...old.data, sequence: 2, previousId: old.id, content: { ...old.data.content, requirements: old.data.content.requirements.map(q => ({ ...q, privateExtension: { marker: 'EXTRA_CANARY' } })) } } })); (await s.update('task', task.id, task.revision, { ...task.data, currentRequestId: next.id })); });
            const d = await textDraft(id);
            await save(id, d);
            const result = await sub.submit(brand, id, await submissionInput(id));
            expect((await sub.snapshot(brand, result.ids[0])).evaluation.canSubmitFull).toBe(true);
            expect(JSON.stringify(await sub.workspace(brand, id))).not.toContain('EXTRA_CANARY');
        });
        it('persisted unknown nested extensions never cross live draft/snapshot output and same-key replay is allowlisted', async () => {
            await setup();
            const id = await task(), d = await textDraft(id);
            await save(id, d);
            await repo.transaction(async (s) => { const row = (await s.list('submissionDraft', A))[0]; (await s.update('submissionDraft', row.id, row.revision, { ...row.data, answers: row.data.answers.map(a => ({ ...a, input: { ...a.input, secret: 'CANARY' }, provenance: { ...a.provenance, secret: 'CANARY' } })), secret: 'CANARY' } as typeof row.data)); });
            expect(JSON.stringify(await sub.workspace(brand, id))).not.toContain('CANARY');
            const submitted = await sub.submit(brand, id, await submissionInput(id));
            expect(JSON.stringify(await sub.snapshot(brand, submitted.ids[0]))).not.toContain('CANARY');
        });
    });
describe('canonical typed evaluator', () => {
    it('all eight valid shapes, zero normalization and invalid objects never count as text/number', () => {
        const c = payload();
        c.requirements = requirementTypes.map(type => ({ ...blankRequirement(type, type), label: type, options: type === 'choice' ? ['yes', 'no'] : [] }));
        const inputs = { short_text: { text: '짧게' }, long_text: { text: '길게' }, file: { fileVersionIds: ['file-id'] }, choice: { selected: ['yes'] }, number: { value: '0' }, date: { value: '2026-09-21', precision: 'date', timezone: 'Asia/Seoul' }, link: { url: 'https://example.test/video', description: '합성 영상', contentFixed: false, fixedReference: null }, physical_record: { summary: '제공자가 기록한 실물 상태', items: [], evidenceFileVersionIds: [], observedAt: null, source: '제공자 기록' } };
        const answers = c.requirements.map(q => ({ requestId: 'request', requirementKey: q.key, productId: null, type: q.type, input: inputs[q.type] }) as AnswerInput);
        expect(evaluateAnswers(c, answers).canSubmitFull).toBe(true);
        expect(() => parseAnswerInput('short_text', { text: { x: 1 } })).toThrow();
        const bad = answers.map(a => a.type === 'number' ? { ...a, input: { value: 'NaN' } } : a);
        expect(evaluateAnswers(c, bad).invalid).toBe(1);
    });
    it('inactive condition ancestry ignores stale descendants, product scope and specification changes demand reconfirmation', () => {
        const c = payload();
        c.requirements = [{ ...blankRequirement('parent', 'choice'), options: ['yes', 'no'] }, { ...blankRequirement('child', 'choice'), options: ['go'], condition: { key: 'parent', equals: 'yes' } }, { ...blankRequirement('leaf'), condition: { key: 'child', equals: 'go' } }];
        const a: AnswerInput[] = [{ requestId: 'old', requirementKey: 'parent', productId: null, type: 'choice', input: { selected: ['no'] } }, { requestId: 'old', requirementKey: 'child', productId: null, type: 'choice', input: { selected: ['go'] } }];
        expect(evaluateAnswers(c, a).items.map(i => i.status)).toEqual(['received', 'not_applicable', 'not_applicable']);
        const previous = structuredClone(c);
        c.requirements[0].unit = '변경';
        expect(evaluateAnswers(c, a, previous).items[0].status).toBe('needs_reconfirmation');
    });
});
