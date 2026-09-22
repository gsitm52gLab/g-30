import { AiAssetStorage, type AssetReadCheck } from './storage';
import type { StorageTransport } from '@/server/storage/contracts';
import { storedText, storedCount, storedHash } from './stored';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { IdentityService } from '@/server/auth/service';
import type { AiVisibility } from '@/domain/ai-input/records';
import { id, str } from '@/domain/ai-input/validate';
import { INPUT_LIMITS } from '@/domain/ai-input/types';
import { preflight } from '@/domain/ai-input/preflight';
import { fail } from '@/server/auth/errors';
import { receipt, newId } from '@/server/products/store';
import { assetAccess, contextAccess } from './access';
import { contentHash } from './extraction';
import { provenance } from './provenance';
import type { StoredRecord } from '@/domain/records';
export const fileDirectory = () => path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || '.data/files');
export function assetDTO(row: StoredRecord<'aiAsset'>) { return { id: row.id, contextId: row.contextId!, filename: storedText(row.data.filename), mime: storedText(row.data.mime), bytes: storedCount(row.data.bytes), sha256: storedHash(row.data.sha256), visibility: row.data.visibility, createdAt: row.createdAt, provenance: provenance(row.data.sha256), url: `/api/ai-input/assets/${encodeURIComponent(row.id)}` }; }
export class AiAssets {
    constructor(readonly identity: IdentityService, readonly directory = fileDirectory(), private fault?: (stage: string) => void, private transport?: () => StorageTransport) { }
    get storage() { return new AiAssetStorage(this.identity, this.transport); }
    destination(key: string) { return path.join(this.directory, 'ai-input', id(key)); }
    async check(token: string | undefined, contextId: string, visibility: AiVisibility) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await contextAccess(s, p, id(contextId), this.identity.clock, visibility)); return p.user.id; }); }
    async upload(token: string | undefined, contextId: string, visibility: AiVisibility, key: string, file: {
        name: string;
        type: string;
        bytes: Buffer;
    }) {
        await this.check(token, contextId, visibility);
        if (this.identity.repo.mode === 'supabase') fail('DIRECT_UPLOAD_REQUIRED', 422, '직접 업로드 경로를 사용해 주세요.');
        str(key);
        const bytes = Buffer.from(file.bytes), sha256 = contentHash(bytes), assetId = newId(), name = str(file.name, 240), mime = str(file.type, 100);
        const admitted = preflight({ scope: { classification: 'general_cosmetic', language: 'ja', media: 'pop', use: 'local upload validation' }, ...(mime === 'application/pdf' ? { kind: 'pdf', source: { sourceId: assetId, versionId: assetId, contextId, sha256, filename: name, mime, bytes }, selectedPages: [1] } : { kind: 'images', sources: [{ sourceId: assetId, versionId: assetId, contextId, sha256, filename: name, mime, bytes }] }) });
        if (!admitted.ok)
            fail(admitted.issue, 422, '파일 형식, 크기 또는 내용이 입력 한도에 맞지 않습니다.');
        if (bytes.length > INPUT_LIMITS.fileBytes)
            fail('SIZE_LIMIT', 422, '파일 크기 한도를 초과했습니다.');
        const dest = this.destination(assetId);
        await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
        await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
        let retained = false;
        try {
            return await this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await contextAccess(s, p, contextId, this.identity.clock, visibility)); const result = (await receipt(s, p, contextId, 'ai.upload', { idempotencyKey: key, filename: name, mime, sha256, visibility }, async () => { (await s.create('aiAsset', { id: assetId, contextId, data: { createdBy: p.user.id, visibility, filename: name, mime, bytes: bytes.length, sha256, storageKey: assetId } })); this.fault?.('upload'); return { ids: [assetId] }; })); const row = (await assetAccess(s, p, result.ids[0], contextId, this.identity.clock, visibility)); retained = row.id === assetId; return assetDTO(row); });
        }
        finally {
            if (!retained)
                await unlink(dest).catch(() => undefined);
        }
    }
    async download(token: string | undefined, assetId: string, extra?: AssetReadCheck) { if (this.identity.repo.mode === 'supabase') { const loaded = await this.storage.snapshot(token, assetId, extra); return { bytes: loaded.bytes, metadata: assetDTO(loaded.row) }; } const row = await this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), row = (await s.get('aiAsset', id(assetId))); if (!row?.contextId)
        fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.'); await extra?.(s, row); return (await assetAccess(s, p, row.id, row.contextId, this.identity.clock)); }); let bytes: Buffer; try {
        bytes = await readFile(this.destination(row.data.storageKey));
    }
    catch {
        fail('STORAGE_UNAVAILABLE', 503, '원본 파일을 읽을 수 없습니다.');
    } await this.identity.repo.transaction(async (s) => { const current = await assetAccess(s, await this.identity.principal(s, token), row.id, row.contextId!, this.identity.clock); await extra?.(s, current); }); if (contentHash(bytes) !== row.data.sha256)
        fail('SOURCE_CHANGED', 503, '원본 파일의 무결성을 확인할 수 없습니다.'); return { bytes, metadata: assetDTO(row) }; }
}
