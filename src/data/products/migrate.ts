import { createHash } from "node:crypto";
import { StoreError, type UnitOfWork } from "@/domain/records";
import { blankCommon, blankContext, normalizeProductCode } from "@/domain/products/types";
/** Domain migration uses the same lossless transaction in mock and SQLite. */
export function migrateLegacyProducts(s: UnitOfWork, fault?: () => void) {
    let migrated = 0;
    for (const old of s.list("product")) {
        if (old.data.schemaVersion === 2)
            continue;
        const context = old.contextId ? s.get("context", old.contextId) : null;
        if (!context?.data.brandId || typeof old.data.name !== "string" || !old.data.name.trim() || typeof old.data.code !== "string" || !old.data.code.trim())
            throw new StoreError("INVALID_RECORD");
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
        s.create("productMigration", { id: `pm-${key}`, contextId: old.contextId, data: { productId: old.id, legacyContextId: old.contextId!, legacyRevision: old.revision, legacyData: old.data as unknown as Record<string, unknown> } });
        s.update("product", old.id, old.revision, { ...old.data, schemaVersion: 2, brandId: context.data.brandId, currentVersionId: null, archivedAt: old.data.status === "archived" ? at : null, legacyContextId: old.contextId }, { legacyProductContextId: old.contextId! });
        s.create("productVersion", { id: productVersionId, contextId: null, data: { productId: old.id, sequence: 1, previousId: null, common, archived: old.data.status === "archived", changedBy: actor, changedAt: at, source } });
        const current = s.get("product", old.id)!;
        s.update("product", old.id, current.revision, { ...current.data, currentVersionId: productVersionId });
        const fields = blankContext();
        fields.salesStatus = old.data.status === "active" ? "selling" : old.data.status === "archived" ? "stopped" : "planned";
        s.create("contextProduct", { id: cpId, contextId: old.contextId, data: { productId: old.id, brandId: context.data.brandId, normalizedCode: normalizeProductCode(old.data.code), currentVersionId: null } });
        s.create("contextProductVersion", { id: cpVersionId, contextId: old.contextId, data: { contextProductId: cpId, sequence: 1, previousId: null, fields, files: [], changedBy: actor, changedAt: at, source } });
        const cp = s.get("contextProduct", cpId)!;
        s.update("contextProduct", cp.id, cp.revision, { ...cp.data, currentVersionId: cpVersionId });
        migrated++;
        fault?.();
    }
    return { migrated };
}
