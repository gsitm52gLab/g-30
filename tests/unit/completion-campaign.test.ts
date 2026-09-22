import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository, RecordKind } from '@/domain/records';
import type { CompletionRecords } from '@/domain/completion/types';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import type { IdentityService } from '@/server/auth/service';
import { CompletionService } from '@/server/completion/service';
import { collectBasis } from '@/server/completion/collect';
import { snapshotDTO } from '@/server/completion/projection';
import { SubmissionService } from '@/server/submissions/service';
import { EvidenceService } from '@/server/evidence/service';
import { policyFixture, NOW } from '../fixtures/policy';
import { admin, brand, contextId } from '../fixtures/completion';
import { completionCampaign, campaignMarker } from '../fixtures/completion-campaign';
const kinds: RecordKind[] = ['completionSnapshot', 'task', 'audit', 'domainEvent', 'commandReceipt'];
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} completion consumes actual G12`, () => {
        let repo: RecordRepository, identity: IdentityService, service: CompletionService, fixture: Awaited<ReturnType<typeof completionCampaign>>, dir: string;
        async function setup(general = false) { repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); identity = await policyFixture(repo); service = new CompletionService(identity); fixture = await completionCampaign(identity, general); dir = await mkdtemp(path.join(os.tmpdir(), 'completion-campaign-')); }
        async function input() { const w = await service.workspace(admin, fixture.taskId); return { command: 'complete', taskId: fixture.taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() }; }
        async function basis() { const b = (await service.workspace(admin, fixture.taskId)).preview!.basis; if (b.campaign.state !== 'available')
            throw Error('campaign unavailable'); return { b, c: b.campaign.value, menu: b.campaign.value.campaigns[0].menus[0] }; }
        const writes = () => Promise.all(kinds.map(k => repo.list(k)));
        afterEach(async () => { (await repo?.close()); if (dir)
            await rm(dir, { recursive: true, force: true }); });
        it('C11-G12-01 selected P1 only: canonical two requirements, unselected P2 evidence0; same-UoW read is pure', async () => {
            await setup();
            await fixture.select();
            const before = await writes(), { b, c, menu } = await basis();
            expect(c.requestSource).toMatchObject({ materialProductIds: [fixture.p1.productId], noMaterials: false });
            expect((await new SubmissionService(identity).workspace(brand, fixture.taskId)).request.content.requirements.map(q => q.key)).toEqual(['proof', 'url']);
            expect(b.currentEvaluation).toMatchObject({ value: { required: 2, missing: 2 } });
            expect(menu).toMatchObject({ active: true, missingRequired: 2, missingFollowup: 2, missingReceiptObservation: 2, reminderEligible: true });
            expect(c.campaigns[0].menus.slice(1).map(m => [m.active, m.missingRequired, m.reminderEligible])).toEqual([[false, 0, false], [false, 0, false]]);
            const evidence = await new EvidenceService(identity).table(brand, contextId);
            expect(evidence.rows.find(p => p.productId === fixture.p2.productId)?.counts).toMatchObject({ requested: 0, missing: 0 });
            expect(await writes()).toEqual(before);
        });
        it('C11-G12-02/05 applied then decline: material0 does not erase hold, physical or pending followups; noMemo complete; later fact preserves snapshot', async () => {
            await setup();
            await fixture.select();
            await fixture.applied();
            await fixture.select('decline');
            const { b, c, menu } = await basis();
            expect(c.requestSource).toMatchObject({ noMaterials: true, materialProductIds: [], retainedRequirementKeys: ['proof', 'url'] });
            expect(c.requestSource!.retainedCancellationMenuKeys).not.toHaveLength(0);
            expect((await new SubmissionService(identity).workspace(brand, fixture.taskId)).request.content.requirements).toEqual([]);
            expect(b.currentEvaluation).toMatchObject({ value: { required: 0, missing: 0 } });
            expect(menu).toMatchObject({ active: false, retainedForCancellationReview: true, state: { response: 'decline', application: 'applied', cancellation: 'discussion' }, missingRequired: 0, missingFollowup: 0, missingReceiptObservation: 0, reminderEligible: false });
            expect(menu.physical.map(p => [p.requestedQuantity, p.receipt])).toEqual([['1', 'unconfirmed'], ['100', 'unconfirmed']]);
            expect(menu.followups.map(f => f.status)).toEqual(['pending', 'pending']);
            const id = (await service.command(admin, await input())).ids[0], original = await repo.get('completionSnapshot', id), publicBefore = await service.snapshot(brand, id);
            expect(original!.data.memo).toBe('');
            expect(original!.data.basis.campaign).toEqual(b.campaign);
            const task = await repo.get('task', fixture.taskId);
            await fixture.physical('tracking');
            expect(await repo.get('task', fixture.taskId)).toEqual(task);
            expect(await service.snapshot(brand, id)).toEqual(publicBefore);
            expect(await repo.get('completionSnapshot', id)).toEqual(original);
            await service.command(admin, { command: 'reopen', taskId: fixture.taskId, completionId: id, expectedTaskRevision: task!.revision, reason: '실물 후속 관찰', idempotencyKey: randomUUID() });
            const next = (await service.command(admin, await input())).ids[0];
            expect(next).not.toBe(id);
            expect(await repo.get('completionSnapshot', id)).toEqual(original);
            const nextCampaign = (await service.snapshot(brand, next)).basis.campaign;
            if (nextCampaign.state !== 'available')
                throw Error('next campaign');
            expect(nextCampaign.value.campaigns[0].menus[0].physical[0].facts).toEqual([{ id: expect.any(String), sequence: expect.any(Number) }]);
        });
        it('C11-G12-03/04 tracking and dispatch do not receive; quantity0 receipt only satisfies its observation; actual new fact invalidates CAS without task revision', async () => {
            await setup();
            await fixture.select();
            const prior = await input(), task = await repo.get('task', fixture.taskId);
            await fixture.physical('tracking');
            let menu = (await basis()).menu;
            expect(menu.physical[0]).toMatchObject({ dispatchFacts: 0, receiptFacts: 0, receipt: 'unconfirmed', fulfillment: 'not_inferred' });
            expect(await repo.get('task', fixture.taskId)).toEqual(task);
            const rows = await writes();
            await expect(service.command(admin, prior)).rejects.toMatchObject({ status: 409, code: 'BASIS_CHANGED' });
            expect(await writes()).toEqual(rows);
            const dispatch = (await fixture.physical('dispatch')).ids[1];
            menu = (await basis()).menu;
            expect(menu.physical[0]).toMatchObject({ dispatchFacts: 1, receiptFacts: 0, receipt: 'unconfirmed' });
            await fixture.physical('receipt', [dispatch]);
            menu = (await basis()).menu;
            expect(menu.physical[0]).toMatchObject({ dispatchFacts: 1, receiptFacts: 1, receipt: 'explicit_receipt_recorded', fulfillment: 'not_inferred' });
            expect(menu.physical[1]).toMatchObject({ dispatchFacts: 0, receiptFacts: 0, requestedQuantity: '100' });
            expect(menu.missingReceiptObservation).toBe(1);
            const cmd = await input(), before = await writes();
            await expect(new CompletionService(identity, () => { throw Error('late campaign completion'); }).command(admin, cmd)).rejects.toThrow('late campaign completion');
            expect(await writes()).toEqual(before);
            const result = await Promise.all([service.command(admin, cmd), service.command(admin, cmd)]);
            expect(result[0]).toEqual(result[1]);
            expect(await repo.list('completionSnapshot')).toHaveLength(1);
        });
        it('General noncampaign requirement is retained after decline; no universal noMaterials override', async () => {
            await setup(true);
            await fixture.select();
            await fixture.applied();
            await fixture.select('decline');
            const { b, c } = await basis();
            expect(c.requestSource).toMatchObject({ noMaterials: false });
            expect((await new SubmissionService(identity).workspace(brand, fixture.taskId)).request.content.requirements.map(q => q.key)).toEqual(['general']);
            expect(b.currentEvaluation).toMatchObject({ value: { required: 1, missing: 1 } });
        });
        it('C11-G12-06 exact actual submitted evidence, public minimum, current revocation and immutable old not_connected snapshot', async () => {
            await setup();
            await fixture.select();
            const ref = await fixture.submitted(dir);
            await fixture.physical('tracking', [], [ref]);
            const id = (await service.command(admin, await input())).ids[0], original = (await repo.get('completionSnapshot', id))!;
            const projected = await service.snapshot(brand, id);
            expect(projected.basis.campaign).toMatchObject({ state: 'available' });
            const text = JSON.stringify(projected);
            expect(text).not.toContain(campaignMarker);
            expect(text).not.toContain('12345');
            expect(projected).not.toHaveProperty('basisHash');
            expect(JSON.stringify(projected.basis.campaign)).not.toContain(ref.fileVersionIds[0]);
            const legacyId = randomUUID(), legacy = { ...original.data, sequence: 2, basis: { ...original.data.basis, campaign: { connected: false as const, state: 'not_connected' as const, value: null } } };
            await repo.transaction(async (s) => (await s.create('completionSnapshot', { id: legacyId, contextId, data: legacy })));
            const stored = await repo.get('completionSnapshot', legacyId);
            expect((await service.snapshot(brand, legacyId)).basis.campaign).toEqual(legacy.basis.campaign);
            expect(await repo.get('completionSnapshot', legacyId)).toEqual(stored);
            await repo.transaction(async (s) => { const m = (await s.list('membership', contextId)).find(m => m.data.userId === 'user-luna')!; (await s.update('membership', m.id, m.revision, { ...m.data, status: 'suspended' })); });
            await expect(service.snapshot(brand, id)).rejects.toMatchObject({ status: 404 });
            expect(await repo.get('completionSnapshot', id)).toEqual(original);
        });
        it('Known nested corruption is safe503; unknown extensions excluded without rewriting captured history; inaccessible source is unavailable notzero', async () => {
            await setup();
            await fixture.select();
            const id = (await service.command(admin, await input())).ids[0], original = (await repo.get('completionSnapshot', id))!;
            if (original.data.basis.campaign.state !== 'available')
                throw Error('fixture campaign');
            const c = original.data.basis.campaign, goodId = randomUUID();
            const extra = { ...original.data, sequence: 2, basis: { ...original.data.basis, campaign: { ...c, value: { ...c.value, secret: campaignMarker } } } };
            await repo.transaction(async (s) => (await s.create('completionSnapshot', { id: goodId, contextId, data: extra })));
            expect(JSON.stringify(await service.snapshot(brand, goodId))).not.toContain(campaignMarker);
            const badId = randomUUID(), bad = structuredClone(extra);
            bad.sequence = 3;
            (bad.basis.campaign.value.campaigns[0].menus[0] as unknown as Record<string, unknown>).missingRequired = { secret: campaignMarker };
            await repo.transaction(async (s) => (await s.create('completionSnapshot', { id: badId, contextId, data: bad as CompletionRecords['completionSnapshot'] })));
            await expect(service.snapshot(brand, badId)).rejects.toMatchObject({ status: 503 });
            expect((await repo.get('completionSnapshot', badId))!.data).toEqual(bad);
            // Simulate a denied exact version at the repository read boundary; never rewrite immutable producers.
            await repo.transaction(async (s) => { const deny = { ...s, get: (async (kind: RecordKind, key: string) => kind === 'campaignVersion' && key === fixture.versionId ? null : (await s.get(kind, key))) as typeof s.get }; const p = (await identity.principal(s, admin)); expect((await snapshotDTO(deny, p, original, () => NOW)).basis.campaign).toEqual({ connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' }); expect((await collectBasis(deny, p, (await s.get('task', fixture.taskId))!, () => NOW)).basis.campaign).toEqual({ connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' }); });
        });
    });
