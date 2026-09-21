import { createHash } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
export type ImportFixtureInput = {
    action: 'snapshot';
} | {
    action: 'poison_batch';
    batchId: string;
    poisonedId: string;
    malformed: boolean;
} | {
    action: 'membership';
    userId: string;
    contextId: string;
    active: boolean;
};
export async function importFixture(repo: RecordRepository, input: ImportFixtureInput) {
    return repo.transaction(s => {
        if (input.action === 'membership') {
            const member = s.list('membership', input.contextId).find(m => m.data.userId === input.userId);
            if (!member)
                throw new Error('synthetic member missing');
            s.update('membership', member.id, member.revision, { ...member.data, status: input.active ? 'active' : 'suspended' });
        }
        if (input.action === 'poison_batch') {
            const original = s.get('importBatch', input.batchId);
            if (!original)
                throw new Error('synthetic batch missing');
            const data = { ...original.data, sourceName: input.malformed ? { nested: 'G07_IMPORT_CANARY' } : original.data.sourceName, rows: original.data.rows.map(r => ({ ...r, ...input.malformed ? { action: { nested: 'G07_IMPORT_CANARY' } } : {}, extra: { secret: 'G07_IMPORT_CANARY' } })), extra: { secret: 'G07_IMPORT_CANARY' } } as unknown as typeof original.data;
            s.create('importBatch', { id: input.poisonedId, contextId: original.contextId, data });
        }
        const kinds: RecordKind[] = ['evidence', 'evidenceVersion', 'evidenceLink', 'evidenceAssessment', 'importBatch', 'product', 'contextProduct', 'productVersion', 'contextProductVersion', 'retailPrice', 'retailPriceVersion', 'internalPrice', 'internalPriceVersion', 'submission', 'productUseSnapshot', 'fileVersion', 'audit', 'domainEvent', 'commandReceipt'];
        const hashes = Object.fromEntries(kinds.map(k => { const rows = s.list(k).sort((a, b) => a.id.localeCompare(b.id)); return [k, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]; }));
        return hashes;
    });
}
export type ImportFixtureSnapshot = Awaited<ReturnType<typeof importFixture>>;
