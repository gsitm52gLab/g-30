import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { IdentityService } from '@/server/auth/service';
import { AuthError, fail } from '@/server/auth/errors';
import { StoreError } from '@/domain/records';
import type { InquiryUploadItem, InquiryUploadResult } from '@/domain/inquiries/types';
import { inquiryId } from '@/domain/inquiries/validate';
import { validateFile, MAX_BATCH_FILES } from '@/domain/files/validate';
import { resolveInquiry } from './access';
import { fileDTO } from './projection';
import { hash, receipt, receiptKey, replay } from './receipts';
import * as safe from './stored';
export class InquiryFiles {
    constructor(public identity: IdentityService, public directory = path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || '.data/files'), private fault?: () => void, private afterWrite?: () => Promise<void>) { }
    async check(token: string | undefined, id: string, visibility: 'public' | 'internal' = 'public') {
        inquiryId(id);
        if (!['public', 'internal'].includes(visibility))
            fail('VALIDATION', 422, '파일 공개 범위를 확인해 주세요.');
        return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), { row } = (await resolveInquiry(s, p, id, this.identity.clock)); if (visibility === 'internal' && p.user.data.role !== 'gsg')
            fail('FORBIDDEN', 403, '내부 자료를 올릴 권한이 없습니다.'); return { userId: p.user.id, contextId: row.contextId! }; });
    }
    async upload(token: string | undefined, id: string, items: InquiryUploadItem[], visibility: 'public' | 'internal' = 'public') {
        if (!Array.isArray(items) || !items.length || items.length > MAX_BATCH_FILES)
            fail('VALIDATION', 422, '파일을 1~10개 선택해 주세요.');
        const ids = items.map(i => inquiryId(i.clientItemId));
        if (new Set(ids).size !== ids.length)
            fail('VALIDATION', 422, '파일별 재시도 키는 달라야 합니다.');
        const actor = await this.check(token, id, visibility), results: InquiryUploadResult[] = [];
        for (const item of items) {
            let written: string | undefined;
            try {
                if (!(item.bytes instanceof Uint8Array) || typeof item.name !== 'string' || typeof item.type !== 'string')
                    fail('VALIDATION', 422, '파일 내용을 확인해 주세요.');
                const bytes = Buffer.from(item.bytes), parsed = validateFile(item.name, item.type, bytes), sha256 = createHash('sha256').update(bytes).digest('hex');
                const key = receiptKey('upload', actor.userId, id, item.clientItemId), bodyHash = hash({ name: parsed.name, mime: parsed.mime, bytes: bytes.length, sha256, visibility });
                const get = async () => this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token)), { row } = (await resolveInquiry(s, p, id, this.identity.clock));
                    if (visibility === 'internal' && p.user.data.role !== 'gsg')
                        fail('FORBIDDEN', 403, '내부 자료를 올릴 권한이 없습니다.');
                    const old = (await replay(s, key, bodyHash, p.user.id));
                    if (!old)
                        return null;
                    const f = (await s.get('fileVersion', safe.id(old[0])));
                    if (!f)
                        safe.corrupt();
                    return (await fileDTO(s, p, f, row, this.identity.clock));
                });
                const old = await get();
                if (old) {
                    results.push({ clientItemId: item.clientItemId, state: 'ready', file: old });
                    continue;
                }
                const fileId = randomUUID();
                await mkdir(this.directory, { recursive: true, mode: 0o700 });
                written = path.join(this.directory, fileId);
                await writeFile(written, bytes, { flag: 'wx', mode: 0o600 });
                await this.afterWrite?.();
                const file = await this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token)), { row } = (await resolveInquiry(s, p, id, this.identity.clock));
                    if (visibility === 'internal' && p.user.data.role !== 'gsg')
                        fail('FORBIDDEN', 403, '내부 자료를 올릴 권한이 없습니다.');
                    const old = (await replay(s, key, bodyHash, p.user.id));
                    if (old) {
                        const f = (await s.get('fileVersion', safe.id(old[0])));
                        if (!f)
                            safe.corrupt();
                        return (await fileDTO(s, p, f, row, this.identity.clock));
                    }
                    const f = (await s.create('fileVersion', { id: fileId, contextId: row.contextId, data: { taskId: null, owner: { kind: 'inquiry', conversationId: id }, storageKey: fileId, originalName: parsed.name, mime: parsed.mime, bytes: bytes.length, sha256, uploaderId: p.user.id, visibility, preview: parsed.preview } }));
                    (await receipt(s, row.contextId!, key, bodyHash, p.user.id, 'inquiry.upload', [fileId]));
                    this.fault?.();
                    return (await fileDTO(s, p, f, row, this.identity.clock));
                });
                if (file.id !== fileId)
                    await unlink(written);
                written = undefined;
                results.push({ clientItemId: item.clientItemId, state: 'ready', file });
            }
            catch (error) {
                if (written)
                    await unlink(written).catch(() => undefined);
                if (error instanceof AuthError && [401, 403, 404].includes(error.status))
                    throw error;
                results.push({ clientItemId: item.clientItemId, state: 'failed', error: { code: error instanceof AuthError || error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE', message: error instanceof AuthError ? error.message : '파일을 저장하지 못했습니다. 이 파일을 다시 시도해 주세요.', retryable: !(error instanceof AuthError) || error.status >= 500 } });
            }
        }
        await this.check(token, id, visibility);
        return { items: results };
    }
}
