import { AiProviderService } from '@/server/ai-provider/service';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { seed } from '@/server/db/seed';
import { IdentityService } from '@/server/auth/service';
import { AiReviewService } from '@/server/ai-review/service';
import { AiInputService } from '@/server/ai-input/service';
import { CorrectionService } from '@/server/corrections/service';
import { CompletionService } from '@/server/completion/service';
import { syntheticAnalyze } from '@/server/ai-review/engine';
import { publishCorpus, corpusHeadId } from '@/server/ai-review/corpus';
import { policyFixture, NOW, tokenFor } from '../fixtures/policy';
import { ctx, staff, admin, brand, readyInput, inputContent, actualSubmission, revisedCorpus } from '../fixtures/ai-review/server';
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} actual G16 server contracts (synthetic engine)`, () => {
        let repo: RecordRepository, identity: IdentityService, service: AiReviewService, directory: string;
        async function setup() { directory = await mkdtemp(path.join(os.tmpdir(), 'g16-contract-')); repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); identity = await policyFixture(repo); service = new AiReviewService(identity, directory); }
        afterEach(async () => { (await repo?.close()); if (directory)
            await rm(directory, { recursive: true, force: true }); });
        it('actual G15 input -> synthetic immutable result; exact location/authority, missing evidence and no auto editing', async () => {
            await setup();
            const f = await readyInput(identity, directory), before = await repo.get('aiVersion', f.input.version.id);
            const r = await service.start(staff, f.input.id, f.body);
            expect(r.detail).toMatchObject({ state: 'finished', engine: 'synthetic_demo', providerCalled: false, legalApproval: false });
            expect(r.detail.result!.findings[0]).toMatchObject({ category: 'YK-11', original: { quote: '絶対安全' }, risk: 'high', confidence: null, humanReviewRequired: true });
            expect(r.detail.result!.findings[0].legalBasis[0].source.authority).toBe('official_notification');
            expect(r.detail.result!.findings[1].evidenceStatus).toBe('unconfirmed');
            expect(r.detail.result!.limitations).toContain('UNREVIEWED_TRANSLATION');
            expect(await repo.get('aiVersion', f.input.version.id)).toEqual(before);
            expect(await repo.list('correctionOpinion')).toHaveLength(0);
            expect((await service.raw(staff, r.runId)).rawHash).toBe(r.detail.result!.rawHash);
            for (const kind of ['aiAnalysisResult', 'aiCorpusRelease'] as const) {
                const row = (await repo.list(kind))[0];
                await expect(repo.transaction(async (s) => (await s.update(kind, row.id, row.revision, row.data)))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
            }
        });
        it('GSG-only every read/write/raw/corpus path, other context and current revocation; G15 brand input stays readable', async () => {
            await setup();
            const f = await readyInput(identity, directory), r = await service.start(staff, f.input.id, f.body);
            for (const actor of [brand, tokenFor('user-wave'), tokenFor('user-team')]) {
                await expect(service.list(actor, ctx)).rejects.toMatchObject({ status: 404 });
                await expect(service.workspace(actor, f.input.id)).rejects.toMatchObject({ status: 404 });
                await expect(service.detail(actor, r.runId)).rejects.toMatchObject({ status: 404 });
                await expect(service.raw(actor, r.runId)).rejects.toMatchObject({ status: 404 });
                await expect(service.corpus(actor, ctx)).rejects.toMatchObject({ status: 404 });
                await expect(service.start(actor, f.input.id, f.body)).rejects.toMatchObject({ status: 404 });
            }
            expect((await new AiInputService(identity, directory).detail(brand, f.input.id)).id).toBe(f.input.id);
            await repo.transaction(async (s) => { const m = (await s.list('membership', ctx)).find(m => m.data.userId === 'user-gsg')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect(service.detail(staff, r.runId)).rejects.toMatchObject({ status: 404 });
            await expect(service.start(staff, f.input.id, f.body)).rejects.toMatchObject({ status: 404 });
        });
        it('same-intent replay keeps one run/result, new intent needs latest run and never silently selects a provider', async () => {
            await setup();
            const f = await readyInput(identity, directory), r = await service.start(staff, f.input.id, f.body);
            expect((await service.start(staff, f.input.id, f.body)).runId).toBe(r.runId);
            expect(await repo.list('aiAnalysisRun')).toHaveLength(1);
            expect(await repo.list('aiAnalysisResult')).toHaveLength(1);
            await expect(service.start(staff, f.input.id, { ...f.body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
            const second = await service.start(staff, f.input.id, { ...f.body, expectedRunId: r.runId, idempotencyKey: randomUUID() });
            expect(second.detail.attempt).toBe(2);
            expect((await service.detail(staff, r.runId)).result).toEqual(r.detail.result);
            let outbound = 0;
            const provider = new AiProviderService(identity, directory, { config: () => ({ config: null, issue: 'KEY_MISSING' }), transport: async () => { outbound++; throw Error('must not dispatch'); } });
            const missing = await provider.start(staff, f.input.id, { ...f.body, expectedRunId: second.runId, engine: 'provider', idempotencyKey: randomUUID() });
            expect(missing.detail).toMatchObject({ state: 'failed', providerCalled: false, provider: { attempts: [{ issue: 'KEY_MISSING' }] } });
            expect(outbound).toBe(0);
        });
        it('one actual claim while engine awaits; current source/role checked again before dispatch and after result', async () => {
            await setup();
            const f = await readyInput(identity, directory);
            let enter!: () => void, release!: () => void, calls = 0;
            const started = new Promise<void>(r => enter = r), gate = new Promise<void>(r => release = r);
            const worker = new AiReviewService(identity, directory, { analyze: async (s, c) => { calls++; enter(); await gate; return syntheticAnalyze(s, c); } });
            const pending = worker.start(staff, f.input.id, f.body);
            await started;
            expect((await service.start(staff, f.input.id, f.body)).detail.state).toBe('running');
            expect(calls).toBe(1);
            await repo.transaction(async (s) => { const m = (await s.list('membership', ctx)).find(m => m.data.userId === 'user-gsg')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            release();
            await expect(pending).rejects.toMatchObject({ status: 404 });
            expect(await repo.list('aiAnalysisResult')).toHaveLength(0);
            expect((await repo.list('aiAnalysisRun'))[0].data).toMatchObject({ state: 'failed', issue: 'ACCESS_CHANGED', providerCalled: false });
        });
        it('role changes during original IO cannot dispatch even if public G15 input remains readable', async () => {
            await setup();
            const f = await readyInput(identity, directory);
            let calls = 0;
            const worker = new AiReviewService(identity, directory, { afterOriginalLoad: async () => { await repo.transaction(async (s) => { const user = (await s.get('user', 'user-gsg'))!; (await s.update('user', user.id, user.revision, { ...user.data, role: 'brand' })); const m = (await s.list('membership', ctx)).find(m => m.data.userId === user.id)!; (await s.update('membership', m.id, m.revision, { ...m.data, role: 'brand', internalPriceAccess: false })); }); }, analyze: async (s, c) => { calls++; return syntheticAnalyze(s, c); } });
            await expect(worker.start(staff, f.input.id, f.body)).rejects.toMatchObject({ status: 404 });
            expect(calls).toBe(0);
            expect((await new AiInputService(identity, directory).detail(staff, f.input.id)).id).toBe(f.input.id);
            expect(await repo.list('aiAnalysisResult')).toHaveLength(0);
        });
        it('review accept/edit/reject are explicit append-only CAS facts; receipt retry and injected rollback preserve original', async () => {
            await setup();
            const f = await readyInput(identity, directory), r = await service.start(staff, f.input.id, f.body), before = await repo.list('aiAnalysisResult');
            const command = { findingId: 'finding-1', expectedRevision: 0, decision: 'accept', reason: '사람이 문맥 확인', editedSuggestion: null, idempotencyKey: randomUUID() };
            const failed = new AiReviewService(identity, directory, { fault: stage => { if (stage === 'review')
                    throw Error('SYNTHETIC_REVIEW_FAULT'); } });
            const receipts = await repo.list('commandReceipt');
            await expect(failed.review(staff, r.runId, command)).rejects.toThrow('SYNTHETIC_REVIEW_FAULT');
            expect(await repo.list('aiFindingReview')).toEqual([]);
            expect(await repo.list('aiFindingReviewAction')).toEqual([]);
            expect(await repo.list('commandReceipt')).toEqual(receipts);
            const accepted = await service.review(staff, r.runId, command);
            expect((await service.review(staff, r.runId, command)).actionId).toBe(accepted.actionId);
            const first = accepted.detail.result!.findings[0].review;
            expect(first).toMatchObject({ externalExpertApproval: false, current: { decision: 'accept' } });
            const writes = await Promise.allSettled([service.review(staff, r.runId, { ...command, expectedRevision: first.revision, decision: 'edit', editedSuggestion: '사람의 참고 수정안', idempotencyKey: randomUUID() }), service.review(admin, r.runId, { ...command, expectedRevision: first.revision, decision: 'reject', idempotencyKey: randomUUID() })]);
            expect(writes.filter(v => v.status === 'fulfilled')).toHaveLength(1);
            expect(writes.filter(v => v.status === 'rejected')).toHaveLength(1);
            const edited = (await service.detail(staff, r.runId)).result!.findings[0].review;
            expect(edited.history).toHaveLength(2);
            await service.review(staff, r.runId, { ...command, expectedRevision: edited.revision, decision: 'reject', reason: '추가 문맥에 따라 기각', idempotencyKey: randomUUID() });
            expect((await service.detail(staff, r.runId)).result!.findings[0].review.history.map(h => h.decision)).toEqual(['accept', 'edit', 'reject']);
            expect(await repo.list('aiAnalysisResult')).toEqual(before);
            const action = (await repo.list('aiFindingReviewAction'))[0];
            await expect(repo.transaction(async (s) => (await s.update('aiFindingReviewAction', action.id, action.revision, action.data)))).rejects.toMatchObject({ code: 'INVALID_RECORD' });
            await expect(service.review(brand, r.runId, command)).rejects.toMatchObject({ status: 404 });
        });
        it('deployment revision excludes stale current alignments, preserves historical result and re-seed never resets current head', async () => {
            await setup();
            const f = await readyInput(identity, directory), r = await service.start(staff, f.input.id, f.body), originals = await repo.list('aiAnalysisResult'), oldCorpus = await repo.get('aiCorpusRelease', f.body.corpusReleaseId);
            const revised = revisedCorpus();
            await repo.transaction(async (s) => (await publishCorpus(s, revised, f.body.corpusReleaseId)));
            const head = await repo.get('aiCorpusHead', corpusHeadId);
            const after = await service.detail(staff, r.runId);
            expect(after.corpusIsCurrent).toBe(false);
            expect(after.result!.staleExcerptIds).toContain('std4-3-5');
            expect(after.result!.findings[0].legalBasis).toEqual(r.detail.result!.findings[0].legalBasis);
            expect((await seed(repo)).corpus).toEqual({ inserted: 0, preserved: 2 });
            expect(await repo.get('aiCorpusHead', corpusHeadId)).toEqual(head);
            expect(await repo.get('aiCorpusRelease', f.body.corpusReleaseId)).toEqual(oldCorpus);
            expect(await repo.list('aiAnalysisResult')).toEqual(originals);
            expect((await service.start(staff, f.input.id, f.body)).runId).toBe(r.runId);
            await expect(service.start(staff, f.input.id, { ...f.body, expectedRunId: r.runId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CORPUS_CHANGED' });
            await expect(repo.transaction(async (s) => (await publishCorpus(s, { ...revised, manifestHash: '0'.repeat(64) }, revised.id)))).rejects.toMatchObject({ code: 'CORPUS_INVALID' });
        });
        it('changed corpus during execution and malformed engine output preserve distinct failed attempts, not safe results', async () => {
            await setup();
            const f = await readyInput(identity, directory);
            const worker = new AiReviewService(identity, directory, { afterAnalysis: async () => { await repo.transaction(async (s) => (await publishCorpus(s, revisedCorpus(), f.body.corpusReleaseId))); } });
            await expect(worker.start(staff, f.input.id, f.body)).rejects.toMatchObject({ code: 'CORPUS_CHANGED' });
            expect(await repo.list('aiAnalysisResult')).toHaveLength(0);
            expect((await repo.list('aiAnalysisRun'))[0].data.issue).toBe('CORPUS_CHANGED');
            const next = await readyInput(identity, directory), broken = new AiReviewService(identity, directory, { analyze: async () => 'not JSON' });
            await expect(broken.start(staff, next.input.id, next.body)).rejects.toMatchObject({ code: 'RESULT_INVALID' });
            const run = (await service.workspace(staff, next.input.id)).runs[0];
            expect(run).toMatchObject({ state: 'failed', issue: 'RESULT_INVALID' });
            await expect(service.start(staff, next.input.id, { ...next.body, expectedRunId: run.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'RETRY_UNAVAILABLE' });
        });
        it('unknown stored extensions are excluded and malformed known run scalar returns safe error without rewrite', async () => {
            await setup();
            const f = await readyInput(identity, directory), r = await service.start(staff, f.input.id, f.body);
            await repo.transaction(async (s) => { const row = (await s.get('aiAnalysisRun', r.runId))!; (await s.update('aiAnalysisRun', row.id, row.revision, { ...row.data, privateNested: { price: 'G16_STORED_CANARY' } } as typeof row.data)); });
            expect(JSON.stringify(await service.detail(staff, r.runId))).not.toContain('G16_STORED_CANARY');
            expect(JSON.stringify(await service.list(staff, ctx))).not.toContain('G16_STORED_CANARY');
            await repo.transaction(async (s) => { const row = (await s.get('aiAnalysisRun', r.runId))!; (await s.update('aiAnalysisRun', row.id, row.revision, { ...row.data, issue: { hidden: 'G16_STORED_CANARY' } } as unknown as typeof row.data)); });
            const before = await repo.get('aiAnalysisRun', r.runId);
            await expect(service.detail(staff, r.runId)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
            expect(await repo.get('aiAnalysisRun', r.runId)).toEqual(before);
        });
        it('explicit new current basis recovers stale queued work and does not execute an old corpus', async () => {
            await setup();
            const a = await readyInput(identity, directory), b = await readyInput(identity, directory), c = await readyInput(identity, directory);
            let release!: () => void, calls = 0;
            const gate = new Promise<void>(r => release = r), worker = new AiReviewService(identity, directory, { analyze: async (s, corpus) => { calls++; await gate; return syntheticAnalyze(s, corpus); } });
            const one = worker.start(staff, a.input.id, a.body);
            while (calls < 1)
                await new Promise(r => setTimeout(r, 1));
            const two = worker.start(staff, b.input.id, b.body);
            const active = Promise.allSettled([one, two]);
            while (calls < 2)
                await new Promise(r => setTimeout(r, 1));
            const queued = await worker.start(staff, c.input.id, c.body);
            expect(queued.detail.state).toBe('queued');
            expect(calls).toBe(2);
            const revision = revisedCorpus();
            await repo.transaction(async (s) => (await publishCorpus(s, revision, c.body.corpusReleaseId)));
            release();
            expect((await active).every(r => r.status === 'rejected')).toBe(true);
            await expect(service.start(staff, c.input.id, c.body)).rejects.toMatchObject({ code: 'CORPUS_CHANGED' });
            const recovered = await service.start(staff, c.input.id, { ...c.body, expectedRunId: queued.runId, corpusReleaseId: revision.id, corpusManifestHash: revision.manifestHash, idempotencyKey: randomUUID() });
            expect(recovered.detail).toMatchObject({ attempt: 2, state: 'finished', corpusReleaseId: revision.id });
            expect((await repo.get('aiAnalysisRun', queued.runId))!.data).toMatchObject({ state: 'failed', issue: 'CORPUS_CHANGED', resultId: null });
        });
        it('three failed synthetic attempts have explicit bounded recovery capability and no result', async () => {
            await setup();
            const f = await readyInput(identity, directory), broken = new AiReviewService(identity, directory, { analyze: async () => { throw Error('bounded synthetic fault'); } });
            let previous: string | null = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                await expect(broken.start(staff, f.input.id, { ...f.body, expectedRunId: previous, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'ENGINE_ERROR' });
                const latest = (await service.workspace(staff, f.input.id)).runs[0];
                previous = latest.id;
                expect(latest.attempt).toBe(attempt);
                expect((await service.detail(staff, latest.id)).capabilities.rerun).toBe(attempt < 3);
            }
            await expect(service.start(staff, f.input.id, { ...f.body, expectedRunId: previous, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'RETRY_UNAVAILABLE' });
            expect(await repo.list('aiAnalysisResult')).toHaveLength(0);
        });
        it('actual G05 answer -> exact finding -> deliberate G10 opinion; unrelated associated text cannot invent an answer target', async () => {
            await setup();
            const submission = await actualSubmission(identity), f = await readyInput(identity, directory, { ...inputContent(), submission }), r = await service.start(staff, f.input.id, f.body), corrections = new CorrectionService(identity);
            const finding = r.detail.result!.findings[0], target = finding.correctionTargets[0];
            expect(target.answer).toEqual({ requirementKey: 'claim', productId: null });
            const command = { command: 'save_opinion', taskId: submission.taskId, opinionId: null, expectedRevision: 0, opinion: { target, source: { kind: 'ai_candidate', runId: r.runId, findingId: finding.id, source: '합성 데모 검토 후보' }, originalText: 'GSG가 선택한 내부 의견', internalFileVersionIds: [], receivedOn: null, conflictingOpinionVersionIds: [] }, idempotencyKey: randomUUID() };
            await expect(corrections.command(staff, command)).rejects.toMatchObject({ code: 'FINDING_REVIEW_REQUIRED' });
            await service.review(staff, r.runId, { findingId: finding.id, expectedRevision: 0, decision: 'accept', reason: '내부 의견으로 검토', editedSuggestion: null, idempotencyKey: randomUUID() });
            const opinion = await corrections.command(staff, command);
            expect(opinion.ids).toHaveLength(2);
            expect((await corrections.workspace(brand, submission.taskId)).staff).toBeNull();
            expect(await repo.list('correctionBatch')).toHaveLength(0);
            const unrelated = await readyInput(identity, directory, { ...inputContent('別の合成文章。絶対安全。'), submission }), other = await service.start(staff, unrelated.input.id, unrelated.body);
            expect(other.detail.result!.findings[0].correctionTargets).toEqual([]);
            await service.review(staff, other.runId, { findingId: 'finding-1', expectedRevision: 0, decision: 'accept', reason: '검토', editedSuggestion: null, idempotencyKey: randomUUID() });
            await expect(corrections.command(staff, { ...command, opinion: { ...command.opinion, source: { ...command.opinion.source, runId: other.runId, findingId: 'finding-1' } }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
        });
        it('actual failed AI changes G11 basisCAS but never gates memo-free completion; brand history is constant and legacy basis survives', async () => {
            await setup();
            const submission = await actualSubmission(identity), completion = new CompletionService(identity), f = await readyInput(identity, directory, { ...inputContent(), submission });
            const old = await completion.workspace(admin, submission.taskId), before = { command: 'complete', taskId: submission.taskId, expectedTaskRevision: old.taskRevision, expectedBasisHash: old.preview!.basisHash, memo: '', idempotencyKey: randomUUID() };
            await expect(new AiReviewService(identity, directory, { analyze: async () => { throw Error('SYNTHETIC_ENGINE_FAILURE'); } }).start(staff, f.input.id, f.body)).rejects.toMatchObject({ code: 'ENGINE_ERROR' });
            const current = await completion.workspace(admin, submission.taskId);
            expect(current.preview!.basis.ai).toMatchObject({ connected: true, state: 'available', value: { failed: 1, pending: 0, items: [{ state: 'failed', issue: 'ENGINE_ERROR' }] } });
            await expect(completion.command(admin, before)).rejects.toMatchObject({ code: 'BASIS_CHANGED' });
            const id = (await completion.command(admin, { ...before, expectedBasisHash: current.preview!.basisHash, idempotencyKey: randomUUID() })).ids[0], stored = (await repo.get('completionSnapshot', id))!;
            expect(stored.data.memo).toBe('');
            expect((await repo.get('task', submission.taskId))!.data.status).toBe('completed');
            const publicHistory = await completion.snapshot(brand, id);
            expect(publicHistory.basis.ai).toEqual({ connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' });
            expect(JSON.stringify(publicHistory)).not.toContain('ENGINE_ERROR');
            expect(JSON.stringify(publicHistory)).not.toContain(f.input.id);
            const legacy = await repo.transaction(async (s) => (await s.create('completionSnapshot', { id: randomUUID(), contextId: ctx, data: { ...stored.data, sequence: 2, previousCompletionId: id, basis: { ...stored.data.basis, ai: { connected: false, state: 'not_connected', value: null } } } })));
            expect((await completion.snapshot(admin, legacy.id)).basis.ai).toEqual({ connected: false, state: 'not_connected', value: null });
            expect((await completion.snapshot(brand, legacy.id)).basis.ai).toEqual(publicHistory.basis.ai);
            expect(await repo.get('completionSnapshot', id)).toEqual(stored);
        });
    });
