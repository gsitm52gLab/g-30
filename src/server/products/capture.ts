import { createHash } from "node:crypto";
import type { Clock, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import type { ProductUseSnapshotData } from "@/domain/products/types";
import { dateValue, ids } from "@/domain/tasks/validate";
import { fail, unavailable } from "@/server/auth/errors";
import { authorize } from "@/server/policy/policy";
import { taskScope } from "@/server/policy/projection";
import { resolveProduct, productContextScope } from "./access";
import { canReferenceFile } from "@/server/files/access";
import { commonDTO, contextDTO, retailDTO, bindingDTO } from "./projection";
import { fresh, newId } from "./store";
export interface CaptureProductUseInput {
    contextId: string;
    productId: string;
    expectedCommonRevision: number;
    expectedContextRevision: number;
    bindingIds: string[];
    retailPriceVersionId: string | null;
    asOfDate: string;
    ownerType: ProductUseSnapshotData["ownerType"];
    ownerId: string;
    taskId: string | null;
    requestId: string | null;
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Synchronous caller UoW contract. G05 must call within its authenticated submission transaction. */
export function captureProductUse(s: UnitOfWork, p: Principal, input: CaptureProductUseInput, clock: Clock) {
    const r = resolveProduct(s, p, input.contextId, input.productId, clock);
    fresh(r.product, input.expectedCommonRevision);
    fresh(r.relation, input.expectedContextRevision);
    ids([input.ownerId]);
    if (!["prior_use_fixture", "submission", "review", "completion"].includes(input.ownerType))
        fail("VALIDATION", 422, "사용 기록의 출처를 확인해 주세요.");
    if (input.taskId) {
        const task = s.get("task", input.taskId);
        if (!task || task.contextId !== input.contextId || !task.data.productIds.includes(input.productId))
            unavailable();
        authorize(s, p, "task.read", taskScope(task), clock);
    }
    if (input.requestId && (!input.taskId || s.get("requestVersion", input.requestId)?.data.taskId !== input.taskId))
        unavailable();
    const bindingIds = ids(input.bindingIds), asOfDate = dateValue(input.asOfDate);
    const files = bindingIds.map(bindingId => {
        const binding = r.local.data.files.find(b => b.id === bindingId);
        if (!binding)
            unavailable();
        const file = s.get("fileVersion", binding.fileVersionId);
        if (!file)
            unavailable();
        canReferenceFile(s, p, file, productContextScope(input.contextId, input.productId), clock);
        return { fileVersionId: file.id, sha256: file.data.sha256, binding: bindingDTO(binding) };
    });
    let retailPrice: ProductUseSnapshotData["retailPrice"] = null;
    if (input.retailPriceVersionId) {
        const version = s.get("retailPriceVersion", input.retailPriceVersionId), root = version ? s.get("retailPrice", version.data.priceId) : null;
        if (!version || version.contextId !== input.contextId || root?.data.contextProductId !== r.relation.id)
            unavailable();
        retailPrice = retailDTO(version.data.fields);
        if (retailPrice.effectiveFrom && asOfDate < retailPrice.effectiveFrom || retailPrice.effectiveTo && asOfDate > retailPrice.effectiveTo)
            fail("VALIDATION", 422, "선택한 가격 버전의 명시 적용기간과 사용 날짜를 확인해 주세요.");
    }
    const exact = { common: commonDTO(r.common.data.common), context: contextDTO(r.local.data.fields), retailPrice, files };
    return s.create("productUseSnapshot", { id: newId(), contextId: input.contextId, data: { ...exact, ownerType: input.ownerType, ownerId: input.ownerId, taskId: input.taskId, requestId: input.requestId, productId: r.product.id, contextProductId: r.relation.id, productVersionId: r.common.id, contextProductVersionId: r.local.id, retailPriceVersionId: input.retailPriceVersionId, retailSelection: { asOfDate, rule: input.retailPriceVersionId ? "explicit_version_within_stated_dates" : "explicit_none" }, commonRevision: r.product.revision, contextRevision: r.relation.revision, contentHash: hash(exact), fileBindingHash: hash(files), capturedBy: p.user.id, capturedAt: clock() } });
}
/** Later consumers must reauthorize both current relation and every original file scope. */
export function readProductUse(s: UnitOfWork, p: Principal, snapshotId: string, clock: Clock) {
    const row = s.get("productUseSnapshot", snapshotId);
    if (!row?.contextId)
        unavailable();
    const d = row.data;
    resolveProduct(s, p, row.contextId, d.productId, clock);
    if (d.taskId) {
        const task = s.get("task", d.taskId);
        if (!task || task.contextId !== row.contextId)
            unavailable();
        authorize(s, p, "task.read", taskScope(task), clock);
    }
    const files = d.files.map(entry => { const f = s.get("fileVersion", entry.fileVersionId); if (!f)
        unavailable(); canReferenceFile(s, p, f, productContextScope(row.contextId!, d.productId), clock); return { fileVersionId: f.id, sha256: text(f.data.sha256), binding: bindingDTO(entry.binding) }; });
    return { id: row.id, contextId: row.contextId, productId: d.productId, contextProductId: d.contextProductId, productVersionId: d.productVersionId, contextProductVersionId: d.contextProductVersionId, retailPriceVersionId: d.retailPriceVersionId, common: commonDTO(d.common), context: contextDTO(d.context), retailPrice: d.retailPrice ? retailDTO(d.retailPrice) : null, files, retailSelection: { asOfDate: text(d.retailSelection.asOfDate), rule: d.retailSelection.rule === "explicit_version_within_stated_dates" ? "explicit_version_within_stated_dates" : "explicit_none" }, contentHash: text(d.contentHash), fileBindingHash: text(d.fileBindingHash), capturedAt: text(d.capturedAt) };
}
