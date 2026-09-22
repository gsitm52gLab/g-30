import { asyncMap } from "@/domain/async-collections";
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { notificationEventSource } from '@/server/notifications/sources';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { brand } from '../fixtures/completion';
import { completionCampaign, person, source } from '../fixtures/completion-campaign';
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G13 campaign request recipient repair`, async () => {
        let repo: RecordRepository;
        afterEach(() => repo?.close());
        it.each(['selection', 'external_fact'] as const)('S13-R01 %s actual new request preserves primary/co brand candidates independently of GSG event', async (cause) => {
            repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })();
            const identity = await policyFixture(repo), fixture = await completionCampaign(identity);
            if (cause === 'external_fact')
                await fixture.select();
            const beforeTask = (await repo.get('task', fixture.taskId))!, beforeEvents = await repo.list('domainEvent');
            const recorded = cause === 'selection' ? await fixture.select() : await fixture.command('external', {
                campaignVersionId: fixture.versionId, menu: fixture.draft.menus[0].identity,
                fact: { axis: 'selection', value: 'not_selected', requester: person, performedBy: person, occurredAt: null, source: source(), note: '실제 미선정 결과' },
            });
            const afterTask = (await repo.get('task', fixture.taskId))!, request = (await repo.get('requestVersion', afterTask.data.currentRequestId!))!;
            expect(request.id).not.toBe(beforeTask.data.currentRequestId);
            expect(request.data.previousId).toBe(beforeTask.data.currentRequestId);
            expect(request.data.source).toMatchObject({ campaignId: fixture.campaignId, campaignVersionId: fixture.versionId, ...(cause === 'selection' ? { selectionVersionId: recorded.ids[1], sourceFactId: null } : { sourceFactId: recorded.ids[1], noMaterials: true }) });
            const originType = cause === 'selection' ? 'CAMPAIGN_SELECTION_RECORDED' : 'CAMPAIGN_FACT_RECORDED';
            const emitted = (await repo.list('domainEvent')).filter(e => !beforeEvents.some(old => old.id === e.id));
            expect(emitted.map(e => e.data.eventType).sort()).toEqual([originType, 'TASK_REQUEST_REVISED'].sort());
            const revision = emitted.find(e => e.data.eventType === 'TASK_REQUEST_REVISED')!, origin = emitted.find(e => e.data.eventType === originType)!;
            expect(revision.data).toMatchObject({ targetId: fixture.taskId, sourceVersionId: request.id });
            expect(origin.data).toMatchObject({ targetId: fixture.campaignId, sourceVersionId: recorded.ids[1] });
            const recipients = [{ id: 'user-luna', token: brand }, { id: 'user-co', token: tokenFor('user-co') }, { id: 'user-gsg', token: tokenFor('user-gsg') }, { id: 'user-team', token: tokenFor('user-team') }];
            const matrix = await repo.transaction(async (s) => (await asyncMap(recipients, async ({ id, token }) => {
                const p = (await identity.principal(s, token)), revised = (await notificationEventSource(s, p, revision.id, () => NOW)), original = (await notificationEventSource(s, p, origin.id, () => NOW));
                expect(revised.source).toMatchObject({ eventId: revision.id, versionId: request.id });
                expect(original.source).toMatchObject({ eventId: origin.id, versionId: recorded.ids[1] });
                return { userId: id, request: { disposition: revised.disposition, recipientId: revised.recipientId }, origin: { disposition: original.disposition, recipientId: original.recipientId } };
            })));
            expect(matrix).toEqual(recipients.map(({ id }) => ({ userId: id,
                request: { disposition: ['user-luna', 'user-co'].includes(id) ? 'eligible' : 'other_recipient', recipientId: ['user-luna', 'user-co'].includes(id) ? id : null },
                origin: cause === 'selection' ? { disposition: id === 'user-gsg' ? 'eligible' : 'other_recipient', recipientId: id === 'user-gsg' ? id : null } : { disposition: 'invalidation_only', recipientId: null },
            })));
            // These are authorized read facts, not persisted notifications or dedupe/delivery proof.
            expect((await repo.list('domainEvent')).filter(e => emitted.some(row => row.id === e.id))).toEqual(emitted);
            expect(await repo.get('requestVersion', request.id)).toEqual(request);
        });
    });
