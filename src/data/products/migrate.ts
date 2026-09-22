import { createHash } from "node:crypto";
import { StoreError, type UnitOfWork } from "@/domain/records";
import { blankCommon, blankContext, normalizeProductCode } from "@/domain/products/types";
const reasons = ["missing_brand_context", "missing_required_name", "missing_required_code", "duplicate_context_code"] as const;
export type ProductMigrationReason = typeof reasons[number];
export class ProductMigrationError extends StoreError {
    constructor(public productID: string, public sourceContextID: string | null, public reason: ProductMigrationReason) {
        super(reason === "duplicate_context_code" ? "CONFLICT" : "INVALID_RECORD");
    }
}
/** CLI-only allowlist: API handlers keep their existing generic StoreError response. */
export function productMigrationDiagnostic(error: unknown) {
    if (!(error instanceof ProductMigrationError) || !reasons.includes(error.reason))
        return null;
    return { module: "G06", productID: error.productID, sourceContextID: error.sourceContextID, reason: error.reason };
}
/** Domain migration uses the same lossless transaction in mock and SQLite. */
export async function migrateLegacyProducts(s: UnitOfWork, fault?: () => void) {
    let migrated = 0;
    for (const old of (await s.list("product"))) {
        if (old.data.schemaVersion === 2)
            continue;
        const context = old.contextId ? (await s.get("context", old.contextId)) : null;
        if (!context?.data.brandId)
            throw new ProductMigrationError(old.id, old.contextId, "missing_brand_context");
        if (typeof old.data.name !== "string" || !old.data.name.trim())
            throw new ProductMigrationError(old.id, old.contextId, "missing_required_name");
        if (typeof old.data.code !== "string" || !old.data.code.trim())
            throw new ProductMigrationError(old.id, old.contextId, "missing_required_code");
        if ((await s.list("contextProduct", old.contextId!)).some(cp => cp.data.normalizedCode === normalizeProductCode(old.data.code)))
            throw new ProductMigrationError(old.id, old.contextId, "duplicate_context_code");
        const common = blankCommon();
        common.name = old.data.name;
        common.code = old.data.code;
        common.category = typeof old.data.category === "string" ? old.data.category : "";
        common.capacity.raw = typeof old.data.size === "string" ? old.data.size : "";
        const parsed = /^(\d+(?:\.\d+)?)\s+(mL|ml|g|kg|L)$/.exec(common.capacity.raw);
        if (parsed) {
            common.capacity.amount = parsed[1];
            common.capacity.unit = parsed[2];
        }
        const key = createHash("sha256").update(old.id).digest("hex");
        const productVersionId = `pv-legacy-${key}`, cpId = `cp-legacy-${key}`, cpVersionId = `cpv-legacy-${key}`;
        const source = "legacy product migration; original fields preserved", at = old.updatedAt, actor = "system-migration";
        (await s.create("productMigration", { id: `pm-${key}`, contextId: old.contextId, data: { productId: old.id, legacyContextId: old.contextId!, legacyRevision: old.revision, legacyData: old.data as unknown as Record<string, unknown> } }));
        (await s.update("product", old.id, old.revision, { ...old.data, schemaVersion: 2, brandId: context.data.brandId, currentVersionId: null, archivedAt: old.data.status === "archived" ? at : null, legacyContextId: old.contextId }, { legacyProductContextId: old.contextId! }));
        (await s.create("productVersion", { id: productVersionId, contextId: null, data: { productId: old.id, sequence: 1, previousId: null, common, archived: old.data.status === "archived", changedBy: actor, changedAt: at, source } }));
        const current = (await s.get("product", old.id))!;
        (await s.update("product", old.id, current.revision, { ...current.data, currentVersionId: productVersionId }));
        const fields = blankContext();
        fields.salesStatus = old.data.status === "active" ? "selling" : old.data.status === "archived" ? "stopped" : "planned";
        (await s.create("contextProduct", { id: cpId, contextId: old.contextId, data: { productId: old.id, brandId: context.data.brandId, normalizedCode: normalizeProductCode(old.data.code), currentVersionId: null } }));
        (await s.create("contextProductVersion", { id: cpVersionId, contextId: old.contextId, data: { contextProductId: cpId, sequence: 1, previousId: null, fields, files: [], changedBy: actor, changedAt: at, source } }));
        const cp = (await s.get("contextProduct", cpId))!;
        (await s.update("contextProduct", cp.id, cp.revision, { ...cp.data, currentVersionId: cpVersionId }));
        migrated++;
        fault?.();
    }
    return { migrated };
}
