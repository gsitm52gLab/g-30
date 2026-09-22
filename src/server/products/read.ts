import { asyncFilter, asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { productMaterialCounts } from "@/server/evidence/table";
import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { decide, activeMember } from "@/server/policy/policy";
import { projectContext, projectTask, taskScope } from "@/server/policy/projection";
import { fileMetadata, fileUrls, sourceReference } from "@/server/files/service";
import { isPublishedTaskFile, visibleFile } from "@/server/files/access";
import { resolveProduct, productContextScope, visibleProductRelations } from "./access";
import { commonDTO, commonDiff, contextDTO, bindingDTO, retailDTO, internalDTO, provenanceDTO } from "./projection";
import { readProductUse } from "./capture";
import { sharedCommonNotice, type ProductFileBinding } from "@/domain/products/types";
export type ResolvedProduct = Awaited<ReturnType<typeof resolveProduct>>;
async function label(s: UnitOfWork, p: Principal, contextId: string, userId: string) {
    if (userId === p.user.id || (await activeMember(s, userId, contextId))) {
        const name = (await s.get("user", userId))?.data.name;
        return typeof name === "string" ? name : "사용자";
    }
    return userId === "system-migration" ? "데이터 이행" : "공통 정보 편집자";
}
export async function versionMeta(s: UnitOfWork, p: Principal, contextId: string, row: {
    id: string;
    data: Parameters<typeof provenanceDTO>[0];
}) { return { id: row.id, ...provenanceDTO(row.data, (await label(s, p, contextId, row.data.changedBy))) }; }
/** File provenance is independent of the editor/time of a later product binding. */
async function productFileMetadata(s: UnitOfWork, p: Principal, contextId: string, file: StoredRecord<"fileVersion">) {
    const uploader = (await s.get("user", file.data.uploaderId));
    const visible = uploader && uploader.data.status === "active" &&
        (uploader.id === p.user.id || (await activeMember(s, uploader.id, contextId)));
    const uploaderLabel = visible && typeof uploader.data.name === "string" && uploader.data.name.trim()
        ? uploader.data.name : "이전 업로더";
    const uploadedAt = typeof file.createdAt === "string" && Number.isFinite(Date.parse(file.createdAt))
        ? file.createdAt : null;
    return { ...fileMetadata(file), uploaderLabel, uploadedAt };
}
export async function projectedBindings(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock, bindings: ProductFileBinding[]) {
    const scope = productContextScope(r.context.id, r.product.id), ref = { kind: "product" as const, contextId: r.context.id, productId: r.product.id };
    return (await asyncFlatMap((Array.isArray(bindings) ? bindings : []), async (binding) => {
        const file = (await s.get("fileVersion", binding.fileVersionId));
        if (!file || !(await visibleFile(s, p, file, scope, clock)))
            return [];
        return [{ ...bindingDTO(binding), file: { ...(await productFileMetadata(s, p, r.context.id, file)), ...fileUrls(file, ref) } }];
    }));
}
export async function visibleContexts(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    return (await asyncMap((await visibleProductRelations(s, p, clock)).filter(cp => cp.data.productId === r.product.id), async (cp) => projectContext((await s.get("context", cp.contextId!))!)));
}
export function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "retailPrice", clock: Clock): Awaited<ReturnType<typeof publicPrice>>;
export function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "internalPrice", clock: Clock): Awaited<ReturnType<typeof privatePrice>>;
export async function priceView(s: UnitOfWork, p: Principal, r: ResolvedProduct, kind: "retailPrice" | "internalPrice", clock: Clock) {
    void clock;
    return kind === "retailPrice" ? (await publicPrice(s, p, r)) : (await privatePrice(s, p, r));
}
async function publicPrice(s: UnitOfWork, p: Principal, r: ResolvedProduct) {
    const root = (await s.list("retailPrice", r.context.id)).find(x => x.data.contextProductId === r.relation.id);
    const history = root ? (await s.list("retailPriceVersion", r.context.id)).filter(v => v.data.priceId === root.id).sort((a, b) => b.data.sequence - a.data.sequence) : [];
    return { revision: root?.revision ?? 0, selection: "latest_recorded_not_automatic_applicability" as const, current: history[0] ? { ...(await versionMeta(s, p, r.context.id, history[0])), fields: retailDTO(history[0].data.fields) } : null, history: (await asyncMap(history, async (v) => ({ ...(await versionMeta(s, p, r.context.id, v)), fields: retailDTO(v.data.fields) }))) };
}
async function privatePrice(s: UnitOfWork, p: Principal, r: ResolvedProduct) {
    const root = (await s.list("internalPrice", r.context.id)).find(x => x.data.contextProductId === r.relation.id);
    const history = root ? (await s.list("internalPriceVersion", r.context.id)).filter(v => v.data.priceId === root.id).sort((a, b) => b.data.sequence - a.data.sequence) : [];
    return { revision: root?.revision ?? 0, selection: "latest_recorded_not_automatic_applicability" as const, current: history[0] ? { ...(await versionMeta(s, p, r.context.id, history[0])), fields: internalDTO(history[0].data.fields) } : null, history: (await asyncMap(history, async (v) => ({ ...(await versionMeta(s, p, r.context.id, v)), fields: internalDTO(v.data.fields) }))) };
}
export async function productItem(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    const common = commonDTO(r.common.data.common), local = contextDTO(r.local.data.fields), files = (await projectedBindings(s, p, r, clock, r.local.data.files));
    const related = (await asyncFilter((await s.list("task", r.context.id)), async (t) => t.data.productIds.includes(r.product.id) && (await decide(s, p, "task.read", taskScope(t), clock)).allowed));
    return { productId: r.product.id, contextProductId: r.relation.id, context: projectContext(r.context), commonRevision: r.product.revision, contextRevision: r.relation.revision, common, local, archived: r.common.data.archived === true, image: files.find(f => f.purpose === "image" && f.file.mime.startsWith("image/"))?.file ?? null, materialCounts: (await productMaterialCounts(s, p, r.context.id, r.product.id, clock)), relatedTaskCount: related.length, retailPrice: (await publicPrice(s, p, r)).current };
}
export async function productDetail(s: UnitOfWork, p: Principal, r: ResolvedProduct, clock: Clock) {
    const scope = productContextScope(r.context.id, r.product.id), reference = { kind: "product" as const, productId: r.product.id, contextId: r.context.id };
    const editDecision = (await decide(s, p, "product.edit", scope, clock)), canEdit = editDecision.allowed, canPrice = (await decide(s, p, "price.read", { ...scope, requiresInternalPrice: true }, clock)).allowed;
    const commonHistory = (await asyncMap((await s.list("productVersion")).filter(v => v.data.productId === r.product.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => { const previous = v.data.previousId ? (await s.get("productVersion", v.data.previousId)) : null; return { ...(await versionMeta(s, p, r.context.id, v)), common: commonDTO(v.data.common), archived: v.data.archived === true, changes: previous ? commonDiff(previous.data.common, v.data.common) : [] }; }));
    const contextHistory = (await asyncMap((await s.list("contextProductVersion", r.context.id)).filter(v => v.data.contextProductId === r.relation.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => ({ ...(await versionMeta(s, p, r.context.id, v)), fields: contextDTO(v.data.fields), files: (await projectedBindings(s, p, r, clock, v.data.files)) })));
    const files = (await projectedBindings(s, p, r, clock, r.local.data.files));
    const reusableFiles = (await asyncFlatMap((await asyncFilter((await s.list("fileVersion", r.context.id)), async (f) => (await visibleFile(s, p, f, scope, clock)))), async (f) => {
        // Unpublished task files cannot be reused in a public product scope.
        if (f.data.taskId) {
            if (!(await isPublishedTaskFile(s, f)))
                return [];
        }
        return [{ ...(await productFileMetadata(s, p, r.context.id, f)), ...fileUrls(f, sourceReference(f)) }];
    }));
    const tasks = (await asyncFilter((await s.list("task", r.context.id)), async (t) => (await decide(s, p, "task.read", taskScope(t), clock)).allowed));
    const canManageTasks = (await decide(s, p, "task.manage", { id: r.context.id, contextId: r.context.id, kind: "task", visibility: "public" }, clock)).allowed;
    const uses = (await asyncFlatMap((await s.list("productUseSnapshot", r.context.id)).filter(use => use.data.productId === r.product.id), async (use) => {
        try {
            return [{ ...(await readProductUse(s, p, use.id, clock)), producer: ["prior_use_fixture", "submission", "review", "completion"].includes(use.data.ownerType) ? use.data.ownerType : "prior_use_fixture", ownerId: typeof use.data.ownerId === "string" ? use.data.ownerId : "", taskId: typeof use.data.taskId === "string" ? use.data.taskId : null, requestId: typeof use.data.requestId === "string" ? use.data.requestId : null }];
        }
        catch {
            return [];
        }
    }));
    const linkedTasks = (await asyncMap(tasks.filter(t => t.data.productIds.includes(r.product.id)), async (t) => (await projectTask(s, p, t, clock))));
    return { ...(await productItem(s, p, r, clock)), commonVersionId: r.common.id, contextVersionId: r.local.id,
        capabilities: { editCommon: canEdit, editContext: canEdit, editFiles: canEdit, uploadInternalFile: editDecision.allowed && editDecision.internalFields === true, editRetailPrice: canEdit, editInternalPrice: canPrice, linkTask: canManageTasks, archive: canEdit },
        sharedCommonNotice, visibleContexts: (await visibleContexts(s, p, r, clock)), commonHistory, contextHistory, files, reusableFiles,
        uploadUrl: `/api/files?${new URLSearchParams({ productId: reference.productId, contextId: reference.contextId })}`,
        retail: (await publicPrice(s, p, r)), ...(canPrice ? { internal: (await privatePrice(s, p, r)) } : {}), linkedTasks, uses,
        useConnection: { connected: true as const, message: "실제 제출 당시의 상품 사용본을 연결합니다. 검토 사용본은 후속 검토 기능에서 연결됩니다." },
        taskChoices: canManageTasks ? tasks.filter(t => !t.data.productIds.includes(r.product.id)).map(t => ({ id: t.id, title: typeof t.data.title === "string" ? t.data.title : "", revision: t.revision, status: t.data.status })) : [],
        projects: (await s.list("project", r.context.id)).filter(project => canManageTasks || project.data.taskIds.some(id => tasks.some(t => t.id === id))).map(project => ({ id: project.id, title: typeof project.data.title === "string" ? project.data.title : "" })),
        linkedContextChoices: (await asyncFilter((await s.list("context")), async (c) => c.data.brandId === r.product.data.brandId && !(await s.list("contextProduct", c.id)).some(cp => cp.data.productId === r.product.id) && (await decide(s, p, "product.edit", productContextScope(c.id, r.product.id), clock)).allowed)).map(projectContext),
        materialVerification: { connected: true as const, message: "공개 요청과 실제 제출을 바탕으로 자료별 상태를 집계합니다. 적용 확인은 인증 승인을 뜻하지 않습니다." }, };
}
