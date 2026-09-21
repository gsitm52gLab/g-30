import { resolveNotice, releasedNoticeFile, noticeVersionScope as importedNoticeVersionScope } from '@/server/notices/access';
import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { fail, unavailable } from "@/server/auth/errors";
import { authorize, decide } from "@/server/policy/policy";
import { taskScope } from "@/server/policy/projection";
import { resolveProduct, productContextScope } from "@/server/products/access";
import type { ResourceScope } from "@/server/policy/types";
export type FileReference = string | {kind:'notice';noticeId:string;versionId?:string} | {
    kind: "product";
    contextId: string;
    productId: string;
};
export function fileReference(params: URLSearchParams): FileReference {
    if (['taskId','productId','contextId','noticeId','versionId'].some(k=>params.getAll(k).length>1)) fail('VALIDATION',422,'자료 참조를 하나만 지정해 주세요.');
    if(params.has('versionId')&&!params.get('versionId'))fail('VALIDATION',422,'정확한 파일 참조 버전을 지정해 주세요.');
    const taskId=params.get('taskId'),productId=params.get('productId'),contextId=params.get('contextId'),noticeId=params.get('noticeId'),versionId=params.get('versionId');
    if(noticeId&&!taskId&&!productId&&!contextId)return {kind:'notice',noticeId,...versionId?{versionId}:{}};
    if(taskId&&!productId&&!contextId&&!noticeId&&!versionId)return taskId;
    if(!taskId&&productId&&contextId&&!noticeId&&!versionId)return {kind:'product',productId,contextId};
    fail('VALIDATION',422,'업무·상품·공지의 자료 참조를 지정해 주세요.');
}
export function referenceScope(s: UnitOfWork, p: Principal, reference: FileReference, clock: Clock, edit = false): ResourceScope {
    if (typeof reference !== "string" && reference.kind === "notice") {
        const r=resolveNotice(s,p,reference.noticeId,clock,edit,reference.versionId);
        return reference.versionId&&r.version?{...r.scope,sourceScopes:[r.scope,importedNoticeVersionScope(s,r.notice,r.version)]}:r.scope;
    }
    if (typeof reference !== "string") {
        const r = resolveProduct(s, p, reference.contextId, reference.productId, clock, edit);
        return productContextScope(r.context.id, r.product.id);
    }
    const task = s.get("task", reference);
    if (!task)
        unavailable();
    const scope = taskScope(task);
    authorize(s, p, edit ? "task.manage" : "task.read", scope, clock);
    return scope;
}
export function originalScope(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, clock: Clock): ResourceScope {
    const owner = file.data.owner;
    if (owner?.kind === "notice") {
        const r=resolveNotice(s,p,owner.noticeId,clock);
        if(r.notice.contextId!==file.contextId)unavailable();
        return r.scope;
    }
    if (owner?.kind === "product") {
        if (!file.contextId)
            unavailable();
        const r = resolveProduct(s, p, file.contextId, owner.productId, clock);
        if (r.relation.id !== owner.contextProductId)
            unavailable();
        return productContextScope(file.contextId, owner.productId);
    }
    const task = file.data.taskId ? s.get("task", file.data.taskId) : null;
    if (!task || task.contextId !== file.contextId)
        unavailable();
    authorize(s, p, "task.read", taskScope(task), clock);
    return taskScope(task);
}
/** Only stored public request/submission inclusion releases a task file for reuse. */
export function isPublishedTaskFile(s: UnitOfWork, file: StoredRecord<"fileVersion">): boolean {
    const task = file.data.taskId ? s.get("task", file.data.taskId) : null;
    return !!task && task.contextId === file.contextId && taskScope(task).visibility === "public" &&
        (s.list("requestVersion", file.contextId!).some(v => v.data.taskId === task.id && v.data.content.referenceFileIds.includes(file.id)) ||
         s.list("submission", file.contextId!).some(v => v.data.taskId === task.id && v.data.fileVersionIds.includes(file.id)));
}
export function canReadTemporarySubmissionFile(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, target: ResourceScope, clock: Clock): boolean {
    return !!file.data.submissionUpload && target.kind === "task" && target.id === file.data.taskId && decide(s, p, "submission.write", target, clock).allowed;
}
/** For selecting a reference: target need not contain the file yet. Both scopes are fresh. */
export function canReferenceFile(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, target: ResourceScope, clock: Clock) {
    if (file.contextId !== target.contextId)
        unavailable();
    const origin = originalScope(s, p, file, clock);
    authorize(s, p, "file.original", { id: file.id, contextId: file.contextId, kind: "file", visibility: file.data.visibility, originalScope: origin, referenceScope: target }, clock);
    if (origin.kind === 'notice' && !releasedNoticeFile(s,p,file,clock) && !(target.kind==='notice'&&origin.id===target.id&&p.user.data.role==='gsg'))
        fail('VALIDATION',422,'공개된 공지 버전에 포함된 자료만 연결할 수 있습니다.');
    const ownTask = origin.kind === "task" && target.kind === "task" && origin.id === target.id;
    if (file.data.visibility === "public" && origin.kind === "task" && !isPublishedTaskFile(s, file)) {
        if (!ownTask || !(file.data.submissionUpload ? canReadTemporarySubmissionFile(s, p, file, target, clock) : p.user.data.role === "gsg"))
            fail("VALIDATION", 422, "원본 공개 요청 또는 실제 제출에 포함된 자료만 연결할 수 있습니다.");
    }
    return origin;
}
export function visibleFile(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, target: ResourceScope, clock: Clock): boolean {
    try { canReferenceFile(s,p,file,target,clock); return true; } catch { return false; }
}
