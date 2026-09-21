import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unavailable, fail } from '@/server/auth/errors';
export class ImportStaging {
    constructor(public directory = path.resolve(/* turbopackIgnore: true */ process.env.IMPORT_STORAGE_DIR || '.data/imports')) { }
    private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id))
        unavailable(); return path.join(this.directory, `${id}.json`); }
    async put<T extends {
        actorId: string;
    }>(value: T) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const names = (await readdir(this.directory)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
        let actorFiles = 0;
        for (const name of names) {
            const dest = path.join(this.directory, name), info = await stat(dest);
            if (info.mtimeMs < Date.now() - 86400000) {
                await unlink(dest);
                continue;
            }
            try {
                const old = JSON.parse(await readFile(dest, 'utf8'));
                if (old.actorId === value.actorId)
                    actorFiles++;
            }
            catch { }
        }
        if (actorFiles >= 50)
            fail('STAGING_LIMIT', 422, '보관 중인 가져오기 파일이 많습니다. 하루 후 다시 시도해 주세요.');
        const id = randomUUID();
        await writeFile(this.file(id), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
        return id;
    }
    async get<T>(id: string): Promise<T> { try {
        const name = this.file(id);
        if ((await stat(name)).size > 64 * 1024 * 1024)
            unavailable();
        return JSON.parse(await readFile(name, 'utf8')) as T;
    }
    catch {
        unavailable();
    } }
}
