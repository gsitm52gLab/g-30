import { afterEach, describe, expect, it } from 'vitest';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { HomeService } from '@/server/home/service';
import { policyFixture, tokenFor, NOW, CONTEXT } from '../fixtures/policy';
const canary = { internalSupplyPrice: 'G03_HOME_NESTED_PRIVATE_CANARY' };
for (const mode of ['mock', 'sqlite'] as const) describe(`${mode} home stored projection`, () => {
  let repo: RecordRepository;
  afterEach(async () => { await repo?.close(); });
  async function setup() {
    if (mode === 'mock') repo = createMockRepository(() => NOW);
    else { const db = openDatabase(':memory:', true); migrate(db); repo = createSqliteRepository(db, () => NOW); }
    return new HomeService(await policyFixture(repo));
  }
  it.each([
    ['title', canary], ['title', [canary]], ['title', 123], ['title', null], ['nextAction', canary],
  ] as const)('rejects stored malformed task %s without returning nested data; recovery is not an empty success', async (key, value) => {
    const home = await setup(), query = { scope: 'context' as const, context: CONTEXT };
    const before = await home.read(tokenFor('user-team'), query), row = (await repo.get('task', 'task-onboarding'))!;
    await repo.transaction(s => s.update('task', row.id, row.revision, { ...row.data, [key]: value } as typeof row.data));
    await expect(home.read(tokenFor('user-team'), query)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    // A corruption response must not reveal either the hidden value or the field name.
    try { await home.read(tokenFor('user-team'), query); } catch (error) { expect(JSON.stringify(error)).not.toMatch(/G03_HOME_NESTED_PRIVATE_CANARY|internalSupplyPrice/); }
    const damaged = (await repo.get('task', row.id))!;
    await repo.transaction(s => s.update('task', row.id, damaged.revision, row.data));
    expect(await home.read(tokenFor('user-team'), query)).toEqual(before);
  });
  it('does not coerce a stored context label object and preserves authorization precedence', async () => {
    const home = await setup(), row = (await repo.get('context', CONTEXT))!;
    await repo.transaction(s => s.update('context', row.id, row.revision, { ...row.data, retailer: canary as unknown as string }));
    await expect(home.read(tokenFor('user-team'), { scope: 'context', context: CONTEXT })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    await expect(home.read(tokenFor('user-wave'), { scope: 'context', context: CONTEXT })).rejects.toMatchObject({ status: 404 });
  });
  it('rejects a stored current-user label object before serializing the actor', async () => {
    const home = await setup(), row = (await repo.get('user', 'user-team'))!;
    await repo.transaction(s => s.update('user', row.id, row.revision, { ...row.data, name: canary as unknown as string }));
    await expect(home.read(tokenFor('user-team'), { scope: 'context', context: CONTEXT })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
  });
  it('does not inspect an unauthorized context merely because its stored task is malformed', async () => {
    const home = await setup(), query = { scope: 'context' as const, context: CONTEXT }, before = await home.read(tokenFor('user-team'), query);
    const row = (await repo.get('task', 'task-onboarding'))!;
    await repo.transaction(s => s.create('task', { id: 'home-corrupted-hidden', contextId: 'ctx-jp-b-luna', data: { ...row.data, productIds: [], title: canary as unknown as string } }));
    expect(await home.read(tokenFor('user-team'), query)).toEqual(before);
    await expect(home.read(tokenFor('user-team'), { scope: 'all', context: 'ctx-jp-b-luna' })).rejects.toMatchObject({ status: 404 });
  });
});
