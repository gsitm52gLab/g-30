import { createHash, randomUUID } from 'node:crypto';
import type { UnitOfWork } from '@/domain/records';
import { fail } from '@/server/auth/errors';
import * as safe from './stored';
export const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const receiptKey = (...parts: string[]) => hash(['inquiry', ...parts]);
export async function replay(s: UnitOfWork, key: string, bodyHash: string, actorId: string): Promise<string[] | null> {
    const r = (await s.list('commandReceipt')).find(x => x.data.key === key);
    if (!r)
        return null;
    if (r.data.actorId !== actorId)
        safe.corrupt();
    if (r.data.bodyHash !== bodyHash)
        fail('CONFLICT', 409, '같은 재시도 키에 다른 내용을 보낼 수 없습니다. 기존 내용을 확인해 주세요.');
    const result = safe.object(r.data.result), ids = result.ids;
    if (!Array.isArray(ids) || ids.length > 4 || ids.some(x => typeof x !== 'string' || x !== '' && !/^[A-Za-z0-9_-]{1,160}$/.test(x)))
        safe.corrupt();
    return ids.slice();
}
export async function receipt(s: UnitOfWork, contextId: string, key: string, bodyHash: string, actorId: string, command: string, ids: string[], id = randomUUID()) {
    (await s.create('commandReceipt', { id, contextId, data: { key, bodyHash, actorId, command, result: { ids } } }));
}
