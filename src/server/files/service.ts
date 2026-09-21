import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { UnitOfWork, StoredRecord } from "@/domain/records";
import type { Principal, IdentityService } from "@/server/auth/service";
import { authorize } from "@/server/policy/policy";
import { taskScope } from "@/server/policy/projection";
import { TaskService } from "@/server/tasks/service";
import { fail, unavailable } from "@/server/auth/errors";
import { MAX_BATCH_FILES, validateFile } from "@/domain/files/validate";
export const fileMetadata = (f: StoredRecord<"fileVersion">) => ({ id:f.id, name:f.data.originalName, bytes:f.data.bytes, mime:f.data.mime, sha256:f.data.sha256, preview:f.data.preview, visibility:f.data.visibility });
export class FileService {
    constructor(public identity: IdentityService, public directory = path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR || ".data/files"), private fault?: () => void) {}
    private destination(key: string) { if (!/^[a-f0-9-]{36}$/.test(key)) unavailable(); return path.join(this.directory,key); }
    private access(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, taskId: string, mode: "original" | "download" | "preview") {
        const service = new TaskService(this.identity), origin = service.task(s,p,file.data.taskId), reference = service.task(s,p,taskId);
        if (file.contextId !== reference.contextId || file.contextId !== origin.contextId) unavailable();
        const versions = s.list("requestVersion", reference.contextId!).filter(v => v.data.taskId === reference.id);
        const internal = p.user.data.role === "gsg";
        const included = versions.some(v => v.data.content.referenceFileIds.includes(file.id)) || internal && (reference.data.draft?.referenceFileIds.includes(file.id) || reference.id === file.data.taskId);
        if (!included) unavailable();
        authorize(s,p,`file.${mode}`,{id:file.id,contextId:file.contextId,kind:"file",visibility:file.data.visibility,originalScope:taskScope(origin),referenceScope:taskScope(reference)},this.identity.clock);
        if (mode === "preview" && !file.data.preview) fail("VALIDATION",422,"이 형식은 원본 다운로드로 확인해 주세요.");
    }
    async upload(token: string | undefined, taskId: string, files: {name:string;type:string;bytes:Buffer}[], visibility: "public" | "internal") {
        if (!files.length || files.length>MAX_BATCH_FILES || !["public","internal"].includes(visibility)) fail("VALIDATION",422,"한 번에 1~10개 파일과 공개 범위를 선택해 주세요.");
        await this.identity.repo.transaction(s=>{ const p=this.identity.principal(s,token); new TaskService(this.identity).task(s,p,taskId,true); });
        const prepared=files.map(f=>({...validateFile(f.name,f.type,f.bytes),buffer:f.bytes,id:randomUUID(),sha256:createHash("sha256").update(f.bytes).digest("hex")}));
        const written:string[]=[];
        try {
            await mkdir(this.directory,{recursive:true,mode:0o700});
            for (const f of prepared) { const dest=this.destination(f.id); await writeFile(dest,f.buffer,{flag:"wx",mode:0o600}); written.push(dest); }
            return await this.identity.repo.transaction(s=>{ const p=this.identity.principal(s,token), task=new TaskService(this.identity).task(s,p,taskId,true);
                const rows=prepared.map(f=>s.create("fileVersion",{id:f.id,contextId:task.contextId,data:{taskId,storageKey:f.id,originalName:f.name,mime:f.mime,bytes:f.buffer.length,sha256:f.sha256,uploaderId:p.user.id,visibility,preview:f.preview}}));
                this.fault?.(); return {files:rows.map(fileMetadata)};
            });
        } catch(error) { await Promise.all(written.map(f=>unlink(f).catch(()=>undefined))); throw error; }
    }
    async download(token: string | undefined, fileId: string, taskId: string, mode: "original" | "download" | "preview") {
        const row=await this.identity.repo.transaction(s=>{ const p=this.identity.principal(s,token), file=s.get("fileVersion",fileId); if (!file) unavailable(); this.access(s,p,file,taskId,mode); return file; });
        const bytes=await readFile(this.destination(row.data.storageKey));
        // Recheck after asynchronous file IO; no stale permission snapshot at response creation.
        await this.identity.repo.transaction(s=>{ const p=this.identity.principal(s,token); this.access(s,p,row,taskId,mode); });
        if (createHash("sha256").update(bytes).digest("hex")!==row.data.sha256) fail("STORAGE_UNAVAILABLE",503,"파일 무결성을 확인할 수 없습니다.");
        return {bytes,metadata:fileMetadata(row)};
    }
}
