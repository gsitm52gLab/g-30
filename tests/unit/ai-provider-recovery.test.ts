import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { AiProviderService } from '@/server/ai-provider/service';
import { AiReviewService } from '@/server/ai-review/service';
import { emptyTransport, type Transport } from '@/server/ai-provider/transport';
import type { ProviderConfig } from '@/server/ai-provider/config';
import type { RecordRepository } from '@/domain/records';
import { SYNTHETIC_TEXT } from '@/server/ai-input/provenance';
import { policyFixture, NOW } from '../fixtures/policy';
import { staff, readyInput, inputContent } from '../fixtures/ai-review/server';
const success: Transport = async (_c, _r, before, sent) => { await before(); await sent(); return { ...emptyTransport('ENGINE_ERROR'), issue: null, responseId: 'resp_recovery_fixture', responseModel: 'gpt-6-astra', serviceTier: 'default', providerStatus: 'completed', rawCandidate: JSON.stringify({ schemaVersion: 'gs-hale-ai-review/1', findings: [] }) }; };
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G17 frozen ac53 recovery edges`, () => {
        let repo: RecordRepository, directory: string;
        async function setup() { directory = await mkdtemp(path.join(os.tmpdir(), 'g17-recovery-')); repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); await policyFixture(repo); }
        afterEach(async () => { (await repo?.close()); if (directory)
            await rm(directory, { recursive: true, force: true }); });
        it('R17-01 changing exact configured baseURL does not coalesce a failed old basis', async () => { await setup(); const identity = new IdentityService(repo, () => NOW); let cfg: ProviderConfig = { config: { apiKey: undefined, model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' }, issue: 'KEY_MISSING' }; const service = new AiProviderService(identity, directory, { config: () => cfg, transport: success }), f = await readyInput(identity, directory, inputContent(SYNTHETIC_TEXT)); const failed = await service.start(staff, f.input.id, { ...f.body, engine: 'provider' }); expect(failed.detail.provider!.attempts[0].issue).toBe('KEY_MISSING'); cfg = { config: { apiKey: 'synthetic', model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1/' }, issue: null }; const recovered = await service.start(staff, f.input.id, { ...f.body, engine: 'provider', expectedRunId: failed.runId, idempotencyKey: randomUUID() }); expect(recovered.runId).not.toBe(failed.runId); expect(recovered.detail.state).toBe('finished'); expect((await new AiReviewService(identity, directory).detail(staff, failed.runId)).state).toBe('failed'); });
        it('C17-S02 explicit configuration recovery after missing key/auth failure preserves logical identity and bounded receipts', async () => { await setup(); const identity = new IdentityService(repo, () => NOW); let cfg: ProviderConfig = { config: { apiKey: undefined, model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' }, issue: 'KEY_MISSING' }, calls = 0, failAuth = true; const service = new AiProviderService(identity, directory, { config: () => cfg, transport: async (...args) => { calls++; const value = await success(...args); return failAuth ? { ...value, issue: 'PROVIDER_AUTH', rawCandidate: null } : value; } }), f = await readyInput(identity, directory, inputContent(SYNTHETIC_TEXT)); let r = await service.start(staff, f.input.id, { ...f.body, engine: 'provider' }); expect(calls).toBe(0); cfg = { config: { apiKey: 'synthetic-restored-no-secret-hash', model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' }, issue: null }; await expect(service.retry(staff, r.runId, { expectedRevision: r.detail.revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'RETRY_UNAVAILABLE' }); let command = { expectedRevision: r.detail.revision, restartConfiguration: true, idempotencyKey: randomUUID() }; r = await service.retry(staff, r.runId, command); expect(r.detail.provider!.attempts.at(-1)!.issue).toBe('PROVIDER_AUTH'); expect(calls).toBe(1); await service.retry(staff, r.runId, command); expect(calls).toBe(1); failAuth = false; command = { ...command, expectedRevision: r.detail.revision, idempotencyKey: randomUUID() }; r = await service.retry(staff, r.runId, command); expect(r.detail.state).toBe('finished'); expect(r.detail.provider!.attempts).toHaveLength(3); expect(await repo.list('aiAnalysisRun')).toHaveLength(1); expect(calls).toBe(2); await service.retry(staff, r.runId, command); expect(calls).toBe(2); });
        it('R17-02 expired observed call needs explicit bounded recovery; late old response/replayed intent cannot overwrite or resend', async () => { await setup(); let now = NOW, enter!: () => void, release!: () => void, calls = 0; const identity = new IdentityService(repo, () => now), gate = new Promise<void>(r => release = r), entered = new Promise<void>(r => enter = r), cfg = () => ({ config: { apiKey: 'synthetic', model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' }, issue: null }); const service = new AiProviderService(identity, directory, { config: cfg, transport: async (...args) => { await args[2](); await args[3](); const callNumber = ++calls; if (callNumber === 1) {
                enter();
                await gate;
            } return { ...await success(args[0], args[1], async () => { }, async () => { }), responseId: callNumber === 1 ? 'resp_old' : 'resp_new' }; } }); const f = await readyInput(identity, directory, inputContent(SYNTHETIC_TEXT)), pending = service.start(staff, f.input.id, { ...f.body, engine: 'provider' }); await entered; try {
            now = new Date(Date.parse(NOW) + 100000).toISOString();
            const row = (await repo.list('aiAnalysisRun'))[0], before = await new AiReviewService(identity, directory).detail(staff, row.id);
            expect(before.state).toBe('interrupted');
            expect(before.provider!.attempts[0].remoteOutcomeUnknown).toBe(true);
            await expect(service.retry(staff, row.id, { expectedRevision: before.revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'RESPONSE_UNKNOWN' });
            expect(calls).toBe(1);
            const command = { expectedRevision: before.revision, acknowledgeUnknown: true, idempotencyKey: randomUUID() }, recovered = await service.retry(staff, row.id, command);
            expect(recovered.runId).toBe(row.id);
            expect(recovered.detail.state).toBe('finished');
            expect(recovered.detail.provider!.attempts).toHaveLength(2);
            expect(recovered.detail.provider!.attempts[0]).toMatchObject({ issue: 'RESPONSE_UNKNOWN', remoteOutcomeUnknown: true });
            await service.retry(staff, row.id, command);
            expect(calls).toBe(2);
            const resultId = recovered.detail.result!.id;
            release();
            await pending;
            expect((await new AiReviewService(identity, directory).detail(staff, row.id)).result!.id).toBe(resultId);
            expect(await repo.list('aiAnalysisResult')).toHaveLength(1);
        }
        finally {
            release();
            await pending.catch(() => { });
        } });
    });
