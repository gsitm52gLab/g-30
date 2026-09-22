import { it, expect } from 'vitest';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
it('G08 migration adds constraints to populated accepted G05 DB without changing edited business records', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gs-hale-g08-migrate-')), source = path.resolve('src/server/db/migrations'), db = openDatabase(':memory:', true);
    let repo: ReturnType<typeof createSqliteRepository> | undefined;
    try {
        for (const name of readdirSync(source).filter(n => /^000[1-5]-.*\.sql$/.test(n)))
            copyFileSync(path.join(source, name), path.join(directory, name));
        expect(migrate(db, directory).total).toBe(5);
        repo = createSqliteRepository(db);
        await seed(repo);
        await repo.transaction(async (s) => { const t = (await s.get('task', 'task-pop'))!; (await s.update('task', t.id, t.revision, { ...t.data, title: '기존 사용자가 수정한 실제 데이터' })); });
        const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all();
        expect(migrate(db)).toEqual({ applied: 11, total: 16 });
        expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        expect(migrate(db)).toEqual({ applied: 0, total: 16 });
        expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
    }
    finally {
        if (repo)
            repo.close();
        else
            db.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
