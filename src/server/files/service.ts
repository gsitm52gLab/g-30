import { inquiryFileIncluded } from '@/server/inquiries/access';
import { resolveNotice } from '@/server/notices/access';
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { UnitOfWork, StoredRecord } from "@/domain/records";
import type { FileOwner } from "@/domain/tasks/types";
import type { Principal, IdentityService } from "@/server/auth/service";
import { authorize, decide } from "@/server/policy/policy";
import { fail, unavailable } from "@/server/auth/errors";
import { MAX_BATCH_FILES, validateFile } from "@/domain/files/validate";
import { originalScope, referenceScope, canReferenceFile, canReadTemporarySubmissionFile, type FileReference } from "./access";
import { taskScope } from "@/server/policy/projection";
import { contentFiles } from "@/domain/submissions/files";
import { resolveProduct } from "@/server/products/access";
const text = (v: unknown) => typeof v === "string" ? v : "";
export const fileMetadata = (f: StoredRecord<"fileVersion">) => ({ id: f.id, name: text(f.data.originalName), bytes: typeof f.data.bytes === "number" ? f.data.bytes : 0, mime: text(f.data.mime), sha256: text(f.data.sha256), preview: f.data.preview === true, visibility: f.data.visibility === "internal" ? "internal" as const : "public" as const });
export function fileUrls(file: StoredRecord<"fileVersion">, reference: FileReference) {
    const query = typeof reference === "string" ? new URLSearchParams({ taskId: reference }) : reference.kind==='inquiry'?new URLSearchParams({conversationId:reference.conversationId,...reference.messageId?{messageId:reference.messageId}:{}}):reference.kind==='notice'?new URLSearchParams({noticeId:reference.noticeId,...reference.versionId?{versionId:reference.versionId}:{}}):new URLSearchParams({ productId: reference.productId, contextId: reference.contextId });
    const base = `/api/files/${encodeURIComponent(file.id)}?${query}`;
    return { originalUrl: `${base}&mode=original`, downloadUrl: `${base}&mode=download`, previewUrl: file.data.preview === true ? `${base}&mode=preview` : null };
}
export function sourceReference(file: StoredRecord<"fileVersion">): FileReference {
    if(file.data.owner?.kind==='inquiry')return {kind:'inquiry',conversationId:file.data.owner.conversationId};
    if(file.data.owner?.kind==='notice')return {kind:'notice',noticeId:file.data.owner.noticeId};
    if (file.data.owner?.kind === "product" && file.contextId)
        return { kind: "product", productId: file.data.owner.productId, contextId: file.contextId };
    if (!file.data.taskId)
        unavailable();
    return file.data.taskId;
}
export class FileService {
    constructor(public identity: IdentityService, public directory = path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || ".data/files"), private fault?: () => void) { }
    private destination(key: string) { if (!/^[a-f0-9-]{36}$/.test(key))
        unavailable(); return path.join(this.directory, key); }
    private access(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, reference: FileReference, mode: "original" | "download" | "preview") {
        const origin = originalScope(s, p, file, this.identity.clock), target = referenceScope(s, p, reference, this.identity.clock);
        if (file.contextId !== target.contextId || file.contextId !== origin.contextId)
            unavailable();
        let included = false;
        if (typeof reference === "string") {
            const task = s.get("task", reference)!;
            const versions = s.list("requestVersion", task.contextId!).filter(v => v.data.taskId === task.id);
            included = decide(s,p,"submission.write",taskScope(task),this.identity.clock).allowed && s.list("submissionDraft",task.contextId!).some(d=>d.data.taskId===task.id && contentFiles(d.data).includes(file.id)) || versions.some(v => v.data.content.referenceFileIds.includes(file.id)) || s.list("submission", task.contextId!).some(v => v.data.taskId === task.id && v.data.fileVersionIds.includes(file.id)) || canReadTemporarySubmissionFile(s,p,file,target,this.identity.clock) || p.user.data.role === "gsg" && (task.data.draft?.referenceFileIds.includes(file.id) === true || task.id === file.data.taskId);
        }
        else if(reference.kind==='inquiry') {
            included=inquiryFileIncluded(s,p,file,reference.conversationId,this.identity.clock,reference.messageId);
        }
        else if(reference.kind==='notice') {
            const r=resolveNotice(s,p,reference.noticeId,this.identity.clock,false,reference.versionId);
            included=!!r.version?.data.content.fileIds.includes(file.id) || p.user.data.role==='gsg' && !reference.versionId && (r.notice.data.draft.fileIds.includes(file.id) || file.data.owner?.kind==='notice'&&file.data.owner.noticeId===r.notice.id);
        }
        else {
            const r = resolveProduct(s, p, reference.contextId, reference.productId, this.identity.clock);
            included = file.data.owner?.kind === "product" && file.data.owner.contextProductId === r.relation.id || s.list("contextProductVersion", reference.contextId).some(v => v.data.contextProductId === r.relation.id && v.data.files.some(f => f.fileVersionId === file.id));
        }
        if (!included)
            unavailable();
        canReferenceFile(s,p,file,target,this.identity.clock);
        authorize(s, p, `file.${mode}`, { id: file.id, contextId: file.contextId, kind: "file", visibility: file.data.visibility, originalScope: origin, referenceScope: target }, this.identity.clock);
        if (mode === "preview" && !file.data.preview)
            fail("VALIDATION", 422, "이 형식은 원본 다운로드로 확인해 주세요.");
    }
    async checkUpload(token: string | undefined, reference: FileReference) {
        return this.identity.repo.transaction(s => referenceScope(s, this.identity.principal(s, token), reference, this.identity.clock, true));
    }
    async upload(token: string | undefined, reference: FileReference, files: {
        name: string;
        type: string;
        bytes: Buffer;
    }[], visibility: "public" | "internal") {
        if (!files.length || files.length > MAX_BATCH_FILES || !["public", "internal"].includes(visibility))
            fail("VALIDATION", 422, "한 번에 1~10개 파일과 공개 범위를 선택해 주세요.");
        if(typeof reference!=='string'&&reference.kind==='inquiry')fail('VALIDATION',422,'문의의 파일별 업로드 경로를 사용해 주세요.');
        await this.checkUpload(token, reference);
        const prepared = files.map(f => ({ ...validateFile(f.name, f.type, f.bytes), buffer: f.bytes, id: randomUUID(), sha256: createHash("sha256").update(f.bytes).digest("hex") }));
        const written: string[] = [];
        try {
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            for (const f of prepared) {
                const dest = this.destination(f.id);
                await writeFile(dest, f.buffer, { flag: "wx", mode: 0o600 });
                written.push(dest);
            }
            return await this.identity.repo.transaction(s => {
                const p = this.identity.principal(s, token), scope = referenceScope(s, p, reference, this.identity.clock, true);
                if (visibility === "internal" && p.user.data.role !== "gsg")
                    fail("FORBIDDEN", 403, "내부 자료를 만들 권한이 없습니다.");
                const owner: FileOwner = typeof reference === "string" ? { kind: "task", taskId: reference } : reference.kind==='notice'?{kind:'notice',noticeId:reference.noticeId}: { kind: "product", productId: reference.productId, contextProductId: resolveProduct(s, p, reference.contextId, reference.productId, this.identity.clock, true).relation.id };
                const rows = prepared.map(f => s.create("fileVersion", { id: f.id, contextId: scope.contextId, data: { taskId: typeof reference === "string" ? reference : null, owner, storageKey: f.id, originalName: f.name, mime: f.mime, bytes: f.buffer.length, sha256: f.sha256, uploaderId: p.user.id, visibility, preview: f.preview } }));
                this.fault?.();
                return { files: rows.map(fileMetadata) };
            });
        }
        catch (error) {
            await Promise.all(written.map(f => unlink(f).catch(() => undefined)));
            throw error;
        }
    }
    async download(token: string | undefined, fileId: string, reference: FileReference, mode: "original" | "download" | "preview") {
        const row = await this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), file = s.get("fileVersion", fileId); if (!file)
            unavailable(); this.access(s, p, file, reference, mode); return file; });
        const bytes = await readFile(this.destination(row.data.storageKey));
        await this.identity.repo.transaction(s => { const p = this.identity.principal(s, token); this.access(s, p, row, reference, mode); });
        if (createHash("sha256").update(bytes).digest("hex") !== row.data.sha256)
            fail("STORAGE_UNAVAILABLE", 503, "파일 무결성을 확인할 수 없습니다.");
        return { bytes, metadata: fileMetadata(row) };
    }
}
