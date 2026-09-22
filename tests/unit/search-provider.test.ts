import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository, UnitOfWork, RecordKind, StoredRecord } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { AiProviderService } from '@/server/ai-provider/service';
import { emptyTransport, type Transport } from '@/server/ai-provider/transport';
import { providerUsage } from '@/domain/ai-provider/usage';
import { SYNTHETIC_TEXT } from '@/server/ai-input/provenance';
import { SearchService } from '@/server/search/service';
import { AuditService } from '@/server/audit/service';
import { policyFixture, NOW, tokenFor } from '../fixtures/policy';
import { ctx, staff, brand, admin, readyInput, inputContent } from '../fixtures/ai-review/server';
import { IdentityService } from '@/server/auth/service';
import { ProductService } from '@/server/products/service';
import { blankInternalPrice } from '@/domain/products/types';
import { AiInputService } from '@/server/ai-input/service';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
const config = () => ({ config: { apiKey: 'synthetic-only-no-network', model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' }, issue: null });
const usage = providerUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1100 });
const success: Transport = async (_c, _r, before, sent) => {
    await before();
    await sent();
    return { ...emptyTransport('ENGINE_ERROR'), issue: null, responseModel: 'gpt-6-astra', serviceTier: 'default', rawCandidate: JSON.stringify({ schemaVersion: 'gs-hale-ai-review/1', findings: [] }), usage };
};
const query = (extra: Record<string, string> = {}) => new URLSearchParams({ context: ctx, ...extra });
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G14 provider consumer`, () => {
        let repo: RecordRepository, identity: IdentityService, directory: string, search: SearchService, audit: AuditService;
        async function setup() {
            directory = await mkdtemp(path.join(os.tmpdir(), 'g14-provider-'));
            repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })();
            identity = await policyFixture(repo);
            search = new SearchService(identity);
            audit = new AuditService(identity);
            return new AiProviderService(identity, directory, { config, transport: success });
        }
        async function run(service: AiProviderService) {
            const f = await readyInput(identity, directory, inputContent(SYNTHETIC_TEXT));
            return service.start(staff, f.input.id, { ...f.body, engine: 'provider' });
        }
        afterEach(async () => { repo?.close(); if (directory)
            await rm(directory, { recursive: true, force: true }); });
        it('P01 actual settings two changes/replays retain exact event booleans and only stored receipt correlation', async () => {
            const service = await setup();
            for (const [expectedRevision, enabled] of [[0, false], [1, true]] as const) {
                const body = { expectedRevision, enabled, idempotencyKey: randomUUID() };
                await service.changeSettings(staff, ctx, body);
                await service.changeSettings(staff, ctx, body);
                await expect(service.changeSettings(staff, ctx, { ...body, enabled: !enabled })).rejects.toMatchObject({ status: 409 });
            }
            const stored = (await repo.list('audit')).filter(r => r.data.action === 'ai.provider.settings');
            expect(stored).toHaveLength(2);
            const list = await audit.list(staff, query({ status: 'ai.provider.settings' }));
            expect(list.total).toBe(2);
            for (const row of stored) {
                const item = await audit.detail(staff, ctx, row.id);
                expect(item).toMatchObject({ sourcePrecision: 'record_only', receiptId: row.data.detail!.receiptId, correlation: 'recorded', versions: [], target: { url: null }, changes: [{ label: '외부 AI 사용', before: row.data.before.enabled ? '사용' : '중지', after: row.data.after.enabled ? '사용' : '중지' }] });
            }
            const row = stored[0];
            const legacy = await repo.transaction(async (s) => (await s.create('audit', { id: randomUUID(), contextId: ctx, data: { ...row.data, detail: undefined } })));
            expect(await audit.detail(staff, ctx, legacy.id)).toMatchObject({ correlation: 'legacy_unavailable', receiptId: null, operationId: null, sourcePrecision: 'record_only' });
            expect(await repo.get('audit', row.id)).toEqual(row);
        });
        it('P02 actual result and attempts contribute bounded search fields and exact finished links, never raw candidate', async () => {
            const service = await setup(), result = await run(service);
            const found = await search.list(staff, query({ q: 'gpt-6-astra', kind: 'analysis' }));
            expect(found.items.filter(x => x.sourceId === result.runId)).toHaveLength(1);
            const detail = await search.detail(staff, ctx, 'aiAnalysisRun', result.runId);
            expect(detail.fields).toContainEqual({ label: '시도 1 · 입력 토큰', value: '1000' });
            expect(detail.fields).toContainEqual({ label: '시도 1 · 추정 비용 USD', value: '0.01395' });
            expect(JSON.stringify(detail)).not.toContain('gs-hale-ai-review/1');
            const row = (await repo.list('audit')).find(r => r.data.action === 'ai.provider.finished')!;
            const item = await audit.detail(staff, ctx, row.id);
            expect(item).toMatchObject({ sourcePrecision: 'exact', receiptId: null, correlation: 'recorded', versions: [{ kind: 'aiAnalysisRun', id: result.runId }] });
            expect(item.fields).toContainEqual({ label: '결과 기록 ID', value: row.data.after.outcomeId });
            expect(item.fields).toContainEqual({ label: '스키마 검증', value: '확인됨 · 법률 승인 아님' });
            expect((await search.list(brand, query({ q: 'gpt-6-astra' }))).total).toBe(0);
        });
        it('P05 persisted malformed known settings scalar fails503 without changing its immutable row', async () => {
            const service = await setup();
            await service.changeSettings(staff, ctx, { enabled: false, expectedRevision: 0, idempotencyKey: randomUUID() });
            const good = (await repo.list('audit')).find(r => r.data.action === 'ai.provider.settings')!;
            const bad = await repo.transaction(async (s) => (await s.create('audit', { id: randomUUID(), contextId: ctx, data: { ...good.data, detail: undefined, after: { enabled: { canary: 'NESTED_PROVIDER_SECRET' } } } })));
            await expect(audit.detail(staff, ctx, bad.id)).rejects.toMatchObject({ status: 503 });
            expect(await repo.get('audit', bad.id)).toEqual(bad);
        });
        it('P02 timeout/unknown retry, parse failure and unaudited catch retain actual attempts; reads perform zero writes/dispatch', async () => {
            await setup();
            let calls = 0;
            const service = new AiProviderService(identity, directory, { config, transport: async (...args) => { calls++; if (calls === 1) {
                    await args[2]();
                    await args[3]();
                    return emptyTransport('TIMEOUT', true);
                } return success(...args); } });
            const failed = await run(service), body = { expectedRevision: failed.detail.revision, acknowledgeUnknown: true, idempotencyKey: randomUUID() };
            expect(failed.detail).toMatchObject({ state: 'failed', legalApproval: false });
            const recovered = await service.retry(staff, failed.runId, body);
            await service.retry(staff, failed.runId, body);
            expect(calls).toBe(2);
            expect(recovered.detail.provider!.attempts).toHaveLength(2);
            const parse = await run(new AiProviderService(identity, directory, { config, transport: async (...args) => ({ ...await success(...args), rawCandidate: 'not-json' }) }));
            const caught = await run(new AiProviderService(identity, directory, { config: () => ({ config: null, issue: 'KEY_MISSING' }), transport: async () => { throw Error('must not call'); } }));
            expect((await repo.list('audit')).filter(r => r.data.action === 'ai.provider.finished' && r.data.targetId === caught.runId)).toHaveLength(0);
            const readonly: RecordRepository = { ...repo, transaction: fn => repo.transaction(s => fn(new Proxy(s, { get(target, key: keyof UnitOfWork) { if (key === 'create' || key === 'update')
                        return () => { throw Error('read mutated business state'); }; return target[key]; } }))) };
            const reader = new SearchService(new IdentityService(readonly, () => NOW)), events = new AuditService(reader.identity);
            const detail = await reader.detail(staff, ctx, 'aiAnalysisRun', recovered.runId);
            expect(detail.fields).toContainEqual({ label: '시도 1 · 원격 결과', value: '불명확' });
            expect(detail.fields).toContainEqual({ label: '시도 1 · 입력 토큰', value: '확인 불가' });
            expect(detail.fields).toContainEqual({ label: '시도 2 · 입력 토큰', value: '1000' });
            expect((await reader.list(staff, query({ q: 'PARSE_ERROR' }))).items.some(r => r.sourceId === parse.runId)).toBe(true);
            expect((await reader.list(staff, query({ q: 'KEY_MISSING' }))).items.some(r => r.sourceId === caught.runId)).toBe(true);
            expect((await events.list(staff, query({ status: 'ai.provider.finished' }))).total).toBe(3);
            expect(calls).toBe(2);
        });
        it('P03 fresh roles/context and nonprice exclude hidden price existence before filter/options/count', async () => {
            const service = await setup();
            const before = await search.list(brand, query({ q: 'gpt-6-astra' }));
            await run(service);
            expect(await search.list(brand, query({ q: 'gpt-6-astra' }))).toEqual(before);
            await expect(audit.list(brand, query())).rejects.toMatchObject({ status: 404 });
            await expect(search.list(tokenFor('user-wave'), query())).rejects.toMatchObject({ status: 404 });
            expect((await search.list(staff, query({ q: '0.01395' }))).total).toBe(1);
            const prior = await audit.list(staff, query()), products = new ProductService(identity);
            await products.command(tokenFor('user-price'), 'product-serum', { command: 'save_internal', contextId: ctx, expectedPriceRevision: 0, price: { ...blankInternalPrice(), supplyAmount: '92555333', source: 'PRIVATE_ONLY_PRICE', currency: 'JPY' }, idempotencyKey: randomUUID() });
            expect(await audit.list(staff, query())).toEqual(prior);
            expect((await search.list(staff, query({ q: 'PRIVATE_ONLY_PRICE' }))).total).toBe(0);
            await repo.transaction(async (s) => { const m = (await s.list('membership', ctx)).find(x => x.data.userId === 'user-gsg')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect(search.list(staff, query())).rejects.toMatchObject({ status: 404 });
            await expect(audit.list(staff, query())).rejects.toMatchObject({ status: 404 });
        });
        it('P04 actual submitted PDF old run is removed by original-scope denial while new text version remains readable', async () => {
            const service = await setup(), tasks = new TaskService(identity), submissions = new SubmissionService(identity), inputs = new AiInputService(identity, directory);
            const content = { ...blankContent(), title: 'ORIGINAL_SCOPE_TASK', description: '합성 원본', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('pdf', 'file'), label: 'PDF' }] };
            const taskId = (await tasks.create(admin, { category: 'spot', content, targets: [{ contextId: ctx, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], idempotencyKey: randomUUID() })).ids[0];
            await tasks.command(admin, taskId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
            let w = await submissions.workspace(brand, taskId);
            const uploaded = (await new SubmissionFiles(identity, directory).upload(brand, taskId, w.request.id, [{ clientItemId: randomUUID(), name: 'native.pdf', type: 'application/pdf', bytes: await readFile('tests/fixtures/ai-input/native-12.pdf') }])).items[0];
            if (uploaded.state !== 'ready')
                throw Error('file fixture failed');
            await submissions.draft(brand, taskId, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'pdf', productId: null, type: 'file', input: { fileVersionIds: [uploaded.file.id] } }] }, idempotencyKey: randomUUID() });
            w = await submissions.workspace(brand, taskId);
            const submissionId = (await submissions.submit(brand, taskId, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'full', idempotencyKey: randomUUID() })).ids[0];
            const f = await readyInput(identity, directory, { ...inputContent(), kind: 'pdf', text: null, sources: [{ kind: 'submission_file', fileVersionId: uploaded.file.id }], selectedPages: [2], submission: { taskId, requestId: w.request.id, submissionId, productUseIds: [] } });
            const old = await service.start(staff, f.input.id, { ...f.body, engine: 'provider' });
            expect(old.detail.state).toBe('finished');
            const newer = await inputs.revise(brand, f.input.id, { expectedRevision: f.input.revision, content: { ...inputContent(SYNTHETIC_TEXT), title: 'CURRENT_STILL_READABLE' }, idempotencyKey: randomUUID() });
            const event = (await repo.list('audit')).find(r => r.data.action === 'ai.provider.finished' && r.data.targetId === old.runId)!;
            expect((await search.list(staff, query({ q: 'gpt-6-astra' }))).total).toBe(1);
            // No per-task GSG revocation command exists. This own persisted invalid-scope fixture
            // tests current source denial, not an operator UI or new revocation capability.
            await repo.transaction(async (s) => { const t = (await s.get('task', taskId))!; (await s.update('task', t.id, t.revision, { ...t.data, visibility: 'revoked_fixture' } as unknown as typeof t.data)); });
            expect((await inputs.detail(staff, f.input.id)).version.id).toBe(newer.version.id);
            expect((await search.list(staff, query({ q: 'gpt-6-astra' }))).total).toBe(0);
            expect((await search.list(staff, query({ q: 'CURRENT_STILL_READABLE' }))).total).toBe(1);
            await expect(search.detail(staff, ctx, 'aiAnalysisRun', old.runId)).rejects.toMatchObject({ status: 404 });
            await expect(audit.detail(staff, ctx, event.id)).rejects.toMatchObject({ status: 404 });
        });
        it('P05 unknown stored extensions never match and exact outcome crossbinding/nested issue fail closed', async () => {
            const service = await setup(), r = await run(service), other = await run(service);
            const row = (await repo.list('audit')).find(a => a.data.action === 'ai.provider.finished' && a.data.targetId === r.runId)!;
            const unknown = await repo.transaction(async (s) => (await s.create('audit', { id: randomUUID(), contextId: ctx, data: { ...row.data, after: { ...row.data.after, unknown: { canary: 'UNKNOWN_PROVIDER_CANARY' } } } })));
            expect(JSON.stringify(await audit.detail(staff, ctx, unknown.id))).not.toContain('UNKNOWN_PROVIDER_CANARY');
            expect((await audit.list(staff, query({ q: 'UNKNOWN_PROVIDER_CANARY' }))).total).toBe(0);
            const otherOutcome = (await repo.list('aiProviderOutcome')).find(x => x.data.runId === other.runId)!;
            for (const after of [{ ...row.data.after, issue: { canary: 'BAD_ISSUE' } }, { ...row.data.after, outcomeId: otherOutcome.id }]) {
                const bad = await repo.transaction(async (s) => (await s.create('audit', { id: randomUUID(), contextId: ctx, data: { ...row.data, after } })));
                await expect(audit.detail(staff, ctx, bad.id)).rejects.toMatchObject({ status: 503 });
                expect(await repo.get('audit', bad.id)).toEqual(bad);
            }
        });
        it('P05 canonical usage scalar and mutual attempt/outcome relation are checked without rewriting original records', async () => {
            const service = await setup(), r = await run(service), outcome = (await repo.list('aiProviderOutcome'))[0];
            for (const patch of [{ usage: { ...outcome.data.usage, inputTokens: { canary: 'BAD_USAGE' } } }, { attemptId: 'wrong-attempt' }]) {
                const fault = (row: StoredRecord | null) => row?.kind === 'aiProviderOutcome' && row.id === outcome.id ? { ...row, data: { ...row.data, ...patch } } : row;
                // Stored-read fault seam: native writers separately reject malformed provider rows.
                const wrapped: RecordRepository = { ...repo, transaction: fn => repo.transaction(s => fn(new Proxy(s, { get(target, key: keyof UnitOfWork) { if (key === 'get')
                            return async (kind: RecordKind, id: string) => fault((await target.get(kind, id))); if (key === 'list')
                            return async (kind: RecordKind, context?: string) => (await target.list(kind, context)).map(fault); return target[key]; } }) as UnitOfWork)) };
                await expect(new SearchService(new IdentityService(wrapped, () => NOW)).detail(staff, ctx, 'aiAnalysisRun', r.runId)).rejects.toMatchObject({ status: 503 });
                expect(await repo.get('aiProviderOutcome', outcome.id)).toEqual(outcome);
            }
        });
    });
