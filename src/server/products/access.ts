import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { authorize, decide } from "@/server/policy/policy";
import type { ResourceScope } from "@/server/policy/types";
import { unavailable } from "@/server/auth/errors";
export function productContextScope(contextId: string, productId: string): ResourceScope { return { id: productId, contextId, kind: "product", visibility: "public" }; }
export function resolveProduct(s: UnitOfWork, p: Principal, contextId: string, productId: string, clock: Clock, edit = false) {
    authorize(s, p, edit ? "product.edit" : "product.read", productContextScope(contextId, productId), clock);
    const relation = s.list("contextProduct", contextId).find(r => r.data.productId === productId);
    if (!relation)
        unavailable();
    const product = s.get("product", productId), context = s.get("context", contextId);
    if (!product || product.data.schemaVersion !== 2 || !context?.data.brandId || product.data.brandId !== context.data.brandId || relation.data.brandId !== product.data.brandId)
        unavailable();
    const common = product.data.currentVersionId ? s.get("productVersion", product.data.currentVersionId) : null;
    const local = relation.data.currentVersionId ? s.get("contextProductVersion", relation.data.currentVersionId) : null;
    if (!common || common.data.productId !== product.id || !local || local.data.contextProductId !== relation.id)
        unavailable();
    return { product, relation, context, common, local };
}
export function visibleProductRelations(s: UnitOfWork, p: Principal, clock: Clock, contextId?: string) {
    return s.list("contextProduct", contextId).filter(r => !!r.contextId && decide(s, p, "product.read", productContextScope(r.contextId, r.data.productId), clock).allowed);
}
/** Transitional read adapter: explicit scope first, never all common Product rows. */
export function legacyProductScope(s: UnitOfWork, p: Principal, row: StoredRecord<"product">, clock: Clock, contextId?: string) {
    if (contextId)
        return productContextScope(resolveProduct(s, p, contextId, row.id, clock).context.id, row.id);
    if (row.data.schemaVersion !== 2 && row.contextId)
        return productContextScope(row.contextId, row.id);
    const relation = visibleProductRelations(s, p, clock).find(r => r.data.productId === row.id);
    if (!relation?.contextId)
        unavailable();
    return productContextScope(relation.contextId, row.id);
}
