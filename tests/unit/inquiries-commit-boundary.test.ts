import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordRepository, UnitOfWork } from '@/domain/records';
import { StoreError } from '@/domain/records';
import type { IdentityService } from '@/server/auth/service';
import { InquiryService } from '@/server/inquiries/service';

const observed = vi.hoisted(() => ({ order: [] as string[], page: { events: [], cursor: 'committed_cursor', hasMore: false } }));
vi.mock('@/server/inquiries/access', async importOriginal => ({ ...await importOriginal<typeof import('@/server/inquiries/access')>(), activeInquiry: async () => { observed.order.push('authorized'); return { row: { id: 'conversation_commit' } }; } }));
vi.mock('@/server/inquiries/events', async importOriginal => ({ ...await importOriginal<typeof import('@/server/inquiries/events')>(), eventPage: async () => { observed.order.push('page'); return observed.page; } }));

/** Isolates actual service delivery ordering; authorization/projection are stubbed, not claimed verified. */
function service(failCommit: boolean) {
    const repo: Pick<RecordRepository, 'transaction'> = {
        async transaction(operation) {
            const result = await operation({} as UnitOfWork);
            observed.order.push('commit');
            if (failCommit) throw new StoreError('CONFLICT');
            observed.order.push('committed');
            return result;
        },
    };
    const identity = { repo, clock: () => '2026-09-22T00:00:00Z', principal: async () => { observed.order.push('principal'); return {}; } } as unknown as IdentityService;
    return new InquiryService(identity);
}

beforeEach(() => { observed.order.length = 0; });
describe('inquiry cursor delivery after awaited commit', () => {
    it('commit rejection delivers no page or cursor', async () => {
        const deliver = vi.fn();
        await expect(service(true).events('synthetic', 'conversation_commit', new URLSearchParams(), deliver)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(observed.order).toEqual(['principal', 'authorized', 'page', 'commit']);
        expect(deliver).not.toHaveBeenCalled();
    });
    it('successful commit delivers the exact returned page once after commit', async () => {
        const deliver = vi.fn(() => observed.order.push('deliver'));
        const result = await service(false).events('synthetic', 'conversation_commit', new URLSearchParams(), deliver);
        expect(result).toBe(observed.page);
        expect(deliver).toHaveBeenCalledExactlyOnceWith(observed.page);
        expect(observed.order).toEqual(['principal', 'authorized', 'page', 'commit', 'committed', 'deliver']);
    });
    it('delivery failure occurs after commit without replaying the transaction', async () => {
        const deliver = vi.fn(() => { observed.order.push('deliver'); throw new Error('closed stream'); });
        await expect(service(false).events('synthetic', 'conversation_commit', new URLSearchParams(), deliver)).rejects.toThrow('closed stream');
        expect(deliver).toHaveBeenCalledOnce();
        expect(observed.order.filter(value => value === 'commit')).toHaveLength(1);
        expect(observed.order.slice(-2)).toEqual(['committed', 'deliver']);
    });
});
