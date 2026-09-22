import { describe, it, expect } from 'vitest';
import { createMockRepository } from '@/server/repositories/mock';
import { searchTransaction } from '@/server/search/transaction';
import type { RecordRepository, UnitOfWork } from '@/domain/records';

describe('G14 transaction-local immutable read view', () => {
  it('coalesces repeated reads, clones returns and never mutates backing rows', async () => {
    const repo = createMockRepository(); await repo.transaction(s => s.create('checkpoint', { id: 'a', contextId: null, data: { value: 'safe' } }));
    let reads = 0, lists = 0;
    const observed = { ...repo, transaction: fn => repo.transaction(s => fn({ ...s, get: async (kind, id) => { reads++; return s.get(kind, id); }, list: async (kind, contextId) => { lists++; return s.list(kind, contextId); } })) } as RecordRepository;
    let escaped!: UnitOfWork;
    await searchTransaction(observed, async s => {
      escaped = s;
      const first = (await s.get('checkpoint', 'a'))!; first.data.value = 'mutated caller';
      expect((await s.get('checkpoint', 'a'))?.data.value).toBe('safe');
      const rows = await s.list('checkpoint'); rows[0].data.value = 'mutated list'; rows.pop();
      expect((await s.list('checkpoint'))[0].data.value).toBe('safe');
      await expect(s.create('checkpoint', { id: 'b', contextId: null, data: { value: 'deny' } })).rejects.toMatchObject({ code: 'INVALID_RECORD' });
      await expect(s.update('checkpoint', 'a', 1, { value: 'deny' })).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    });
    expect(reads).toBe(1); expect(lists).toBe(1);
    await expect(escaped.get('checkpoint', 'a')).rejects.toMatchObject({ code: 'ASYNC_TRANSACTION' });
    expect((await repo.get('checkpoint', 'a'))?.data.value).toBe('safe'); await repo.close();
  });
  it('does not reuse negative reads or authorization rows across transactions', async () => {
    const repo = createMockRepository();
    expect(await searchTransaction(repo, s => s.get('checkpoint', 'later'))).toBeNull();
    await repo.transaction(s => s.create('checkpoint', { id: 'later', contextId: null, data: { value: 'fresh' } }));
    expect((await searchTransaction(repo, s => s.get('checkpoint', 'later')))?.data.value).toBe('fresh');
    await repo.transaction(s => s.update('checkpoint', 'later', 1, { value: 'revoked' }));
    expect((await searchTransaction(repo, s => s.get('checkpoint', 'later')))?.data.value).toBe('revoked'); await repo.close();
  });
  it('releases failed view and leaves later reads usable', async () => {
    const repo = createMockRepository(); let escaped!: UnitOfWork;
    await expect(searchTransaction(repo, async s => { escaped = s; await s.list('checkpoint'); throw new Error('synthetic read failure'); })).rejects.toThrow('synthetic read failure');
    await expect(escaped.list('checkpoint')).rejects.toMatchObject({ code: 'ASYNC_TRANSACTION' });
    expect(await searchTransaction(repo, s => s.list('checkpoint'))).toEqual([]); await repo.close();
  });
});
