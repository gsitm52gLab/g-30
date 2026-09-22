import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { policyFixture, tokenFor, NOW } from '../fixtures/policy';
import { NoticeService } from '@/server/notices/service';
import { blankNotice } from '@/domain/notices/types';
it('SQLite raw corrupt imported row is safely rejected without rewriting immutable history', async () => {
    const db = openDatabase(':memory:', true);
    migrate(db);
    const repo = createSqliteRepository(db, () => NOW);
    try {
        const identity = await policyFixture(repo), service = new NoticeService(identity), admin = tokenFor('user-admin'), brand = tokenFor('user-luna');
        const id = (await service.create(admin, { contextId: 'ctx-jp-a-luna', content: { ...blankNotice(), title: '합성 공개', body: '읽기 자료' }, idempotencyKey: randomUUID() })).ids[0];
        const version = (await service.command(admin, id, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() })).ids[1];
        const old = (await repo.get('noticeVersion', version))!, badId = randomUUID(), raw = JSON.stringify({ ...old.data, sequence: { secret: 'G08_SQLITE_SEQUENCE_CANARY' } });
        // This is an isolated raw storage corruption fixture, bypassing the normal repository write guard.
        db.prepare('INSERT INTO records(kind,id,context_id,data,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('noticeVersion', badId, old.contextId, raw, 1, NOW, NOW);
        await repo.transaction(async (s) => { const n = (await s.get('notice', id))!; (await s.update('notice', id, n.revision, { ...n.data, currentVersionId: badId })); });
        await expect(service.detail(brand, id)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
        await expect(service.list(brand, 'ctx-jp-a-luna')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
        expect((db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('noticeVersion', badId) as {
            data: string;
        }).data).toBe(raw);
        expect(await repo.get('noticeVersion', version)).toEqual(old);
    }
    finally {
        (await repo.close());
    }
});
