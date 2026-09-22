import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { IdentityService } from '@/server/auth/service';
import { AuthError, fail } from '@/server/auth/errors';
import { StoreError } from '@/domain/records';
import { ids } from '@/domain/tasks/validate';
import { MAX_BATCH_FILES, validateFile } from '@/domain/files/validate';
import { fileMetadata, fileUrls } from '@/server/files/service';
import { submissionTask, assertRequest, capabilities } from './access';
export interface UploadItem {
    clientItemId: string;
    name: string;
    type: string;
    bytes: Buffer;
}
export type UploadResult = {
    clientItemId: string;
    state: 'ready';
    file: ReturnType<typeof fileMetadata> & ReturnType<typeof fileUrls>;
} | {
    clientItemId: string;
    state: 'failed';
    error: {
        code: string;
        message: string;
        retryable: boolean;
    };
};
export class SubmissionFiles {
    constructor(public identity: IdentityService, public directory = path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || '.data/files'), private fault?: () => void) { }
    async check(token: string | undefined, taskId: string, requestId: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), { task } = (await submissionTask(s, p, taskId, this.identity.clock, true));
            assertRequest(task, requestId);
            if (!(await capabilities(s, p, task, this.identity.clock)).upload)
                fail('CONFLICT', 409, '완료된 업무에는 파일을 올릴 수 없습니다.');
            return { userId: p.user.id, contextId: task.contextId! };
        });
    }
    async upload(token: string | undefined, taskId: string, requestId: string, items: UploadItem[]) {
        if (!items.length || items.length > MAX_BATCH_FILES)
            fail('VALIDATION', 422, '한 번에 1~10개 파일을 선택해 주세요.');
        ids(items.map(i => i.clientItemId), MAX_BATCH_FILES);
        const actor = await this.check(token, taskId, requestId), results: UploadResult[] = [];
        for (const item of items) {
            let destination: string | undefined;
            try {
                const parsed = validateFile(item.name, item.type, item.bytes), sha256 = createHash('sha256').update(item.bytes).digest('hex'), bodyHash = createHash('sha256').update(JSON.stringify({ name: parsed.name, mime: parsed.mime, sha256 })).digest('hex');
                const key = createHash('sha256').update(JSON.stringify([actor.userId, taskId, requestId, item.clientItemId])).digest('hex');
                const replay = await this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token)), { task } = (await submissionTask(s, p, taskId, this.identity.clock, true));
                    assertRequest(task, requestId);
                    const old = (await s.list('fileVersion', task.contextId!)).find(f => f.data.submissionUpload?.key === key);
                    if (old && old.data.submissionUpload!.bodyHash !== bodyHash)
                        fail('CONFLICT', 409, '같은 파일 재시도 키에 다른 파일을 사용할 수 없습니다.');
                    return old;
                });
                if (replay) {
                    results.push({ clientItemId: item.clientItemId, state: 'ready', file: { ...fileMetadata(replay), ...fileUrls(replay, taskId) } });
                    continue;
                }
                const id = randomUUID();
                await mkdir(this.directory, { recursive: true, mode: 0o700 });
                destination = path.join(this.directory, id);
                await writeFile(destination, item.bytes, { flag: 'wx', mode: 0o600 });
                const row = await this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token)), { task } = (await submissionTask(s, p, taskId, this.identity.clock, true));
                    assertRequest(task, requestId);
                    if (!(await capabilities(s, p, task, this.identity.clock)).upload)
                        fail('CONFLICT', 409, '완료된 업무에는 파일을 올릴 수 없습니다.');
                    const old = (await s.list('fileVersion', task.contextId!)).find(f => f.data.submissionUpload?.key === key);
                    if (old) {
                        if (old.data.submissionUpload!.bodyHash !== bodyHash)
                            fail('CONFLICT', 409, '같은 파일 재시도 키에 다른 파일을 사용할 수 없습니다.');
                        return old;
                    }
                    const file = (await s.create('fileVersion', { id, contextId: task.contextId, data: { taskId, owner: { kind: 'task', taskId }, storageKey: id, originalName: parsed.name, mime: parsed.mime, bytes: item.bytes.length, sha256, uploaderId: p.user.id, visibility: 'public', preview: parsed.preview, submissionUpload: { key, clientItemId: item.clientItemId, requestId, bodyHash } } }));
                    this.fault?.();
                    return file;
                });
                if (row.id !== id)
                    await unlink(destination);
                destination = undefined;
                results.push({ clientItemId: item.clientItemId, state: 'ready', file: { ...fileMetadata(row), ...fileUrls(row, taskId) } });
            }
            catch (error) {
                if (destination)
                    await unlink(destination).catch(() => undefined);
                const code = error instanceof AuthError || error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
                const status = error instanceof AuthError ? error.status : 503;
                results.push({ clientItemId: item.clientItemId, state: 'failed', error: { code, message: error instanceof AuthError ? error.message : '파일을 저장하지 못했습니다. 이 파일만 다시 시도해 주세요.', retryable: status >= 500 } });
            }
        }
        return { items: results };
    }
}
