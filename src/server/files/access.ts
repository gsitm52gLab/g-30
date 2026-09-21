import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { fail, unavailable } from "@/server/auth/errors";
import { authorize, decide } from "@/server/policy/policy";
import { taskScope } from "@/server/policy/projection";
import { resolveProduct, productContextScope } from "@/server/products/access";
import type { ResourceScope } from "@/server/policy/types";
export type FileReference = string | {
    kind: "product";
    contextId: string;
    productId: string;
};
export function fileReference(params: URLSearchParams): FileReference {
    const taskId = params.get("taskId"), productId = params.get("productId"), contextId = params.get("contextId");
    if (taskId && !productId && !contextId)
        return taskId;
    if (!taskId && productId && contextId)
        return { kind: "product", productId, contextId };
    fail("VALIDATION", 422, "업무 또는 상품의 적용 컨텍스트를 지정해 주세요.");
}
export function referenceScope(s: UnitOfWork, p: Principal, reference: FileReference, clock: Clock, edit = false): ResourceScope {
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
/** For selecting a reference: target need not contain the file yet. Both scopes are fresh. */
export function canReferenceFile(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, target: ResourceScope, clock: Clock) {
    if (file.contextId !== target.contextId)
        unavailable();
    const origin = originalScope(s, p, file, clock);
    authorize(s, p, "file.original", { id: file.id, contextId: file.contextId, kind: "file", visibility: file.data.visibility, originalScope: origin, referenceScope: target }, clock);
    if (file.data.visibility === "public" && origin.visibility !== "public" && origin.id !== target.id)
        fail("VALIDATION", 422, "다른 업무의 참고자료는 원본 업무 공개 후 연결해 주세요.");
    return origin;
}
export function visibleFile(s: UnitOfWork, p: Principal, file: StoredRecord<"fileVersion">, target: ResourceScope, clock: Clock): boolean {
    try {
        const origin = originalScope(s, p, file, clock);
        return file.contextId === target.contextId && decide(s, p, "file.original", { id: file.id, contextId: file.contextId, kind: "file", visibility: file.data.visibility, originalScope: origin, referenceScope: target }, clock).allowed;
    }
    catch {
        return false;
    }
}
