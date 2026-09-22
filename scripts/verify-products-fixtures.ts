/** Private verifier fixture helpers; never imported by application code or exposed as a route. */
import { createHash, randomUUID } from "node:crypto";
import type { RecordRepository } from "@/domain/records";
import { IdentityService } from "@/server/auth/service";
import { captureProductUse } from "@/server/products/capture";
import { resolveProduct } from "@/server/products/access";
export const PRODUCT_CANARY = "G06_STORED_NESTED_PRIVATE_EXTENSION";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function poison<T>(value: T): T {
    if (Array.isArray(value))
        return value.map(poison) as T;
    if (value && typeof value === "object")
        return Object.assign(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, poison(v)])), { privateExtension: { nested: PRODUCT_CANARY } }) as T;
    return value;
}
export interface FixtureRequest {
    action: "capture" | "poison" | "snapshot" | "receipt";
    token?: string;
    productId: string;
    contextId: string;
    body?: Record<string, unknown>;
}
export async function productFixture(repo: RecordRepository, input: FixtureRequest) {
    const identity = new IdentityService(repo);
    return repo.transaction(s => {
        if (input.action === "snapshot") {
            const cp = s.list("contextProduct").filter(c => c.data.productId === input.productId), cpIds = new Set(cp.map(c => c.id)), retail = s.list("retailPrice").filter(r => cpIds.has(r.data.contextProductId)), privatePrice = s.list("internalPrice").filter(r => cpIds.has(r.data.contextProductId));
            const rows = [s.get("product", input.productId), ...cp, ...s.list("productVersion").filter(v => v.data.productId === input.productId), ...s.list("contextProductVersion").filter(v => cpIds.has(v.data.contextProductId)), ...s.list("retailPriceVersion").filter(v => retail.some(r => r.id === v.data.priceId)), ...s.list("internalPriceVersion").filter(v => privatePrice.some(r => r.id === v.data.priceId)), ...s.list("productUseSnapshot").filter(v => v.data.productId === input.productId)];
            return { fileProvenance: s.list("fileVersion", input.contextId).map(f => ({ id: f.id, uploaderId: f.data.uploaderId, createdAt: f.createdAt, sha256: hash(f) })), sha256: hash(rows), canaryStored: JSON.stringify(rows).includes(PRODUCT_CANARY), uses: s.list("productUseSnapshot").filter(v => v.data.productId === input.productId).map(v => ({ id: v.id, sha256: hash(v), contentHash: v.data.contentHash, fileBindingHash: v.data.fileBindingHash })), receipts: s.list("commandReceipt").filter(v => v.data.command.includes(input.productId)).map(v => ({ id: v.id, sha256: hash(v), canaryStored: JSON.stringify(v).includes(PRODUCT_CANARY) })) };
        }
        const principal = identity.principal(s, input.token), r = resolveProduct(s, principal, input.contextId, input.productId, identity.clock);
        if (input.action === "capture") {
            const retail = s.list("retailPrice", input.contextId).find(p => p.data.contextProductId === r.relation.id);
            const row = captureProductUse(s, principal, { contextId: input.contextId, productId: input.productId, expectedCommonRevision: r.product.revision, expectedContextRevision: r.relation.revision, bindingIds: r.local.data.files.map(f => f.id), retailPriceVersionId: retail?.data.currentVersionId ?? null, asOfDate: "2026-09-21", ownerType: "prior_use_fixture", ownerId: "g06-initial-prior-use-http", taskId: null, requestId: null }, identity.clock);
            return { id: row.id, sha256: hash(row), contentHash: row.data.contentHash, fileBindingHash: row.data.fileBindingHash };
        }
        if (input.action === "receipt") {
            const body = input.body!, command = `product.${input.productId}.${body.command}`, key = createHash("sha256").update(`${principal.user.id}:${input.contextId}:${command}:${body.idempotencyKey}`).digest("hex"), bodyHash = hash(body);
            const row = s.create("commandReceipt", { id: randomUUID(), contextId: input.contextId, data: { actorId: principal.user.id, key, command, bodyHash, result: { ids: [input.productId, { nested: PRODUCT_CANARY }], privateExtension: PRODUCT_CANARY } as unknown as {
                        ids: string[];
                    } } });
            return { id: row.id, sha256: hash(row) };
        }
        const version = s.create("productVersion", { id: randomUUID(), contextId: null, data: { ...poison(r.common.data), sequence: r.common.data.sequence + 1, previousId: r.common.id } });
        s.update("product", r.product.id, r.product.revision, { ...r.product.data, currentVersionId: version.id });
        const files = r.local.data.files.map(binding => { const old = s.get("fileVersion", binding.fileVersionId)!; const file = s.create("fileVersion", { id: randomUUID(), contextId: old.contextId, data: poison(old.data) }); return { ...poison(binding), fileVersionId: file.id }; });
        const local = s.create("contextProductVersion", { id: randomUUID(), contextId: input.contextId, data: { ...poison(r.local.data), sequence: r.local.data.sequence + 1, previousId: r.local.id, files } });
        s.update("contextProduct", r.relation.id, r.relation.revision, { ...r.relation.data, currentVersionId: local.id });
        for (const kind of ["retailPrice", "internalPrice"] as const) {
            const root = s.list(kind, input.contextId).find(x => x.data.contextProductId === r.relation.id);
            if (!root?.data.currentVersionId)
                continue;
            if (kind === "retailPrice") {
                const old = s.get("retailPriceVersion", root.data.currentVersionId)!;
                const v = s.create("retailPriceVersion", { id: randomUUID(), contextId: input.contextId, data: { ...poison(old.data), sequence: old.data.sequence + 1, previousId: old.id } });
                s.update("retailPrice", root.id, root.revision, { ...root.data, currentVersionId: v.id });
            }
            else {
                const old = s.get("internalPriceVersion", root.data.currentVersionId)!;
                const v = s.create("internalPriceVersion", { id: randomUUID(), contextId: input.contextId, data: { ...poison(old.data), sequence: old.data.sequence + 1, previousId: old.id } });
                s.update("internalPrice", root.id, root.revision, { ...root.data, currentVersionId: v.id });
            }
        }
        return { poisoned: true };
    });
}
