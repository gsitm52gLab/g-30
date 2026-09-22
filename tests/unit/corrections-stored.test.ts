import { describe, it, expect } from 'vitest';
import { createMockRepository } from '@/server/repositories/mock';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { CorrectionService } from '@/server/corrections/service';
import type { PublishedBatchData } from '@/domain/corrections/types';
for (const mode of ['mock', 'sqlite'] as const)
    describe(`${mode} G10 stored public boundary`, async () => {
        it('A19 malformed known immutable public batch content fails controlled503 without rewriting raw snapshot', async () => {
            const repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })();
            try {
                const identity = await policyFixture(repo), service = new CorrectionService(identity);
                await repo.transaction(async (s) => { (await s.create('correctionDraft', { id: 'poison-source', contextId: 'ctx-jp-a-luna', data: { taskId: 'task-onboarding', createdBy: 'user-admin', publishedVersionId: null, draft: { title: 'source', summary: '', items: [], mode: 'normal', pendingScopes: [], previousBatchVersionId: null } } })); (await s.create('correctionBatch', { id: 'poison-batch', contextId: 'ctx-jp-a-luna', data: { taskId: 'task-onboarding', draftId: 'poison-source', draftRevision: 1, sequence: 1, title: 'Valid title', summary: { private: 'BAD_STORED' }, items: [], mode: 'normal', pendingScopes: [], previousBatchVersionId: null, publishedBy: 'user-admin', publishedAt: NOW, contentHash: 'a'.repeat(64) } as unknown as PublishedBatchData })); });
                const before = await repo.get('correctionBatch', 'poison-batch');
                await expect((await service.detail(tokenFor('user-luna'), 'poison-batch'))).rejects.toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
                await expect((await service.workspace(tokenFor('user-luna'), 'task-onboarding'))).rejects.toMatchObject({ status: 503 });
                expect(await repo.get('correctionBatch', 'poison-batch')).toEqual(before);
            }
            finally {
                repo.close();
            }
        });
    });
