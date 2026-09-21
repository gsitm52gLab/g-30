import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { decide, activeMember } from "@/server/policy/policy";
import { projectContext, projectTask, taskScope } from "@/server/policy/projection";
import { fileMetadata, fileUrls, sourceReference } from "@/server/files/service";
import { visibleFile } from "@/server/files/access";
import { resolveProduct, productContextScope, visibleProductRelations } from "./access";
import { commonDTO, commonDiff, contextDTO, bindingDTO, retailDTO, internalDTO, provenanceDTO } from "./projection";
import { readProductUse } from "./capture";
import { sharedCommonNotice, type ProductFileBinding } from "@/domain/products/types";
export type ResolvedProduct = ReturnType<typeof resolveProduct>;
export const materialCounts = () => ({ connected: false as const, requested: null, missing: null, unconfirmed: null });
function label(s: UnitOfWork, p: Principal, contextId: string, userId: string) {
    if (userId === p.user.id || activeMember(s, userId, contextId)) {
        const name = s.get("user", userId)?.data.name;
        return typeof name === "string" ? name : "사용자";
    }
    return userId === "system-migration" ? "데이터 이행" : "공통 정보 편집자";
}
export function versionMeta(s: UnitOfWork, p: Principal, contextId: string, row: {
    id: string;
    data: Parameters<typeof provenanceDTO>[0];
}) { return { id: row.id, ...provenanceDTO(row.data, label(s, p, contextId, row.data.changedBy)) }; }
/** File provenance is independent of the editor/time of a later product binding. */
function productFileMetadata(s: UnitOfWork, p: Principal, contextId: string, file: StoredRecord<"fileVersion">) {
    const uploader = s.get("user", file.data.uploaderId);
    const visible = uploader && uploader.data.status === "active" &&
        (uploader.id === p.user.id || activeMember(s, uploader.id, contextId));
    const uploaderLabel = visible && typeof uploader.data.name === "string" && uploader.data.name.trim()
        ? uploader.data.name : "이전 업로더";
    const uploadedAt = typeof file.createdAt === "string" && Number.isFinite(Date.parse(file.createdAt))
        ? file.createdAt : null;
    return { ...fileMetadata(file), uploaderLabel, uploadedAt };
}
export function projectedBindings(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock, bindings: ProductFileBinding[]) {
    const scope = productContextScope(r.context.id, r.product.id), ref = { kind: "product" as const, contextId: r.context.id, productId: r.product.id };
    return (Array.isArray(bindings) ? bindings : []).flatMap(binding => {
        const file = s.get("fileVersion", binding.fileVersionId);
        if (!file || !visibleFile(s, p, file, scope, clock))
            return [];
        return [{ ...bindingDTO(binding), file: { ...productFileMetadata(s, p, r.context.id, file), ...fileUrls(file, ref) } }];
    });
}
export function visibleContexts(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    return visibleProductRelations(s, p, clock).filter(cp => cp.data.productId === r.product.id).map(cp => projectContext(s.get("context", cp.contextId!)!));
}
export function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "retailPrice", clock: Clock): ReturnType<typeof publicPrice>;
export function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "internalPrice", clock: Clock): ReturnType<typeof privatePrice>;
export function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "retailPrice" | "internalPrice", clock: Clock) {
    void clock;
    return kind === "retailPrice" ? publicPrice(s, p, r) : privatePrice(s, p, r);
}
function publicPrice(s: UnitOfWork, p: Principal, r: ResolvedProduct) {
    const root = s.list("retailPrice", r.context.id).find(x => x.data.contextProductId === r.relation.id);
    const history = root ? s.list("retailPriceVersion", r.context.id).filter(v => v.data.priceId === root.id).sort((a, b) => b.data.sequence - a.data.sequence) : [];
    return { revision: root?.revision ?? 0, selection: "latest_recorded_not_automatic_applicability" as const, current: history[0] ? { ...versionMeta(s, p, r.context.id, history[0]), fields: retailDTO(history[0].data.fields) } : null, history: history.map(v => ({ ...versionMeta(s, p, r.context.id, v), fields: retailDTO(v.data.fields) })) };
}
function privatePrice(s: UnitOfWork, p: Principal, r: ResolvedProduct) {
    const root = s.list("internalPrice", r.context.id).find(x => x.data.contextProductId === r.relation.id);
    const history = root ? s.list("internalPriceVersion", r.context.id).filter(v => v.data.priceId === root.id).sort((a, b) => b.data.sequence - a.data.sequence) : [];
    return { revision: root?.revision ?? 0, selection: "latest_recorded_not_automatic_applicability" as const, current: history[0] ? { ...versionMeta(s, p, r.context.id, history[0]), fields: internalDTO(history[0].data.fields) } : null, history: history.map(v => ({ ...versionMeta(s, p, r.context.id, v), fields: internalDTO(v.data.fields) })) };
}
export function productItem(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    const common = commonDTO(r.common.data.common), local = contextDTO(r.local.data.fields), files = projectedBindings(s, p, r, clock, r.local.data.files);
    const related = s.list("task", r.context.id).filter(t => t.data.productIds.includes(r.product.id) && decide(s, p, "task.read", taskScope(t), clock).allowed);
    return { productId: r.product.id, contextProductId: r.relation.id, context: projectContext(r.context), commonRevision: r.product.revision, contextRevision: r.relation.revision, common, local, archived: r.common.data.archived === true, image: files.find(f => f.purpose === "image" && f.file.mime.startsWith("image/"))?.file ?? null, materialCounts: materialCounts(), relatedTaskCount: related.length, retailPrice: publicPrice(s, p, r).current };
}
export function productDetail(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    const scope = productContextScope(r.context.id, r.product.id), reference = { kind: "product" as const, productId: r.product.id, contextId: r.context.id };
    const editDecision = decide(s, p, "product.edit", scope, clock), canEdit = editDecision.allowed, canPrice = decide(s, p, "price.read", { ...scope, requiresInternalPrice: true }, clock).allowed;
    const commonHistory = s.list("productVersion").filter(v => v.data.productId === r.product.id).sort((a, b) => b.data.sequence - a.data.sequence).map(v => { const previous = v.data.previousId ? s.get("productVersion", v.data.previousId) : null; return { ...versionMeta(s, p, r.context.id, v), common: commonDTO(v.data.common), archived: v.data.archived === true, changes: previous ? commonDiff(previous.data.common, v.data.common) : [] }; });
    const contextHistory = s.list("contextProductVersion", r.context.id).filter(v => v.data.contextProductId === r.relation.id).sort((a, b) => b.data.sequence - a.data.sequence).map(v => ({ ...versionMeta(s, p, r.context.id, v), fields: contextDTO(v.data.fields), files: projectedBindings(s, p, r, clock, v.data.files) }));
    const files = projectedBindings(s, p, r, clock, r.local.data.files);
    const reusableFiles = s.list("fileVersion", r.context.id).filter(f => visibleFile(s, p, f, scope, clock)).flatMap(f => {
        // Unpublished task files cannot be reused in a public product scope.
        if (f.data.taskId) {
            const task = s.get("task", f.data.taskId);
            if (!task || taskScope(task).visibility !== "public" || !s.list("requestVersion", r.context.id).some(v => v.data.taskId === task.id && v.data.content.referenceFileIds.includes(f.id)))
                return [];
        }
        return [{ ...productFileMetadata(s, p, r.context.id, f), ...fileUrls(f, sourceReference(f)) }];
    });
    const tasks = s.list("task", r.context.id).filter(t => decide(s, p, "task.read", taskScope(t), clock).allowed);
    const canManageTasks = decide(s, p, "task.manage", { id: r.context.id, contextId: r.context.id, kind: "task", visibility: "public" }, clock).allowed;
    const uses = s.list("productUseSnapshot", r.context.id).filter(use => use.data.productId === r.product.id).flatMap(use => { try {
        return [{ ...readProductUse(s, p, use.id, clock), producer: ["prior_use_fixture", "submission", "review", "completion"].includes(use.data.ownerType) ? use.data.ownerType : "prior_use_fixture", ownerId: typeof use.data.ownerId === "string" ? use.data.ownerId : "", taskId: typeof use.data.taskId === "string" ? use.data.taskId : null, requestId: typeof use.data.requestId === "string" ? use.data.requestId : null }];
    }
    catch {
        return [];
    } });
    const linkedTasks = tasks.filter(t => t.data.productIds.includes(r.product.id)).map(t => projectTask(s, p, t, clock));
    return { ...productItem(s, p, r, clock), commonVersionId: r.common.id, contextVersionId: r.local.id,
        capabilities: { editCommon: canEdit, editContext: canEdit, editFiles: canEdit, uploadInternalFile: editDecision.allowed && editDecision.internalFields === true, editRetailPrice: canEdit, editInternalPrice: canPrice, linkTask: canManageTasks, archive: canEdit },
        sharedCommonNotice, visibleContexts: visibleContexts(s, p, r, clock), commonHistory, contextHistory, files, reusableFiles,
        uploadUrl: `/api/files?${new URLSearchParams({ productId: reference.productId, contextId: reference.contextId })}`,
        retail: publicPrice(s, p, r), ...(canPrice ? { internal: privatePrice(s, p, r) } : {}), linkedTasks, uses,
        useConnection: { connected: false as const, message: "실제 제출·검토의 상품 사용 기록 연결은 후속 기능에서 제공됩니다." },
        taskChoices: canManageTasks ? tasks.filter(t => !t.data.productIds.includes(r.product.id)).map(t => ({ id: t.id, title: typeof t.data.title === "string" ? t.data.title : "", revision: t.revision, status: t.data.status })) : [],
        projects: s.list("project", r.context.id).filter(project => canManageTasks || project.data.taskIds.some(id => tasks.some(t => t.id === id))).map(project => ({ id: project.id, title: typeof project.data.title === "string" ? project.data.title : "" })),
        linkedContextChoices: s.list("context").filter(c => c.data.brandId === r.product.data.brandId && !s.list("contextProduct", c.id).some(cp => cp.data.productId === r.product.id) && decide(s, p, "product.edit", productContextScope(c.id, r.product.id), clock).allowed).map(projectContext),
        materialVerification: { connected: false as const, message: "자료별 적용·확인 상태와 집계는 증빙 기능 연결 후 제공됩니다." },
    };
}
