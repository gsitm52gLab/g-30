import { StoreError, type RecordKind, type RecordInput, type SyncUnitOfWork as UnitOfWork } from "../records";
export function productRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    const immutable: RecordKind[] = ["productVersion", "contextProductVersion", "retailPriceVersion", "internalPriceVersion", "productUseSnapshot", "productMigration"];
    if (immutable.includes(kind) && s.get(kind, input.id))
        throw new StoreError("INVALID_RECORD");
    const d = input.data as unknown as Record<string, unknown>;
    if (kind === "product" && d.schemaVersion === 2 && (input.contextId !== null || typeof d.brandId !== "string"))
        throw new StoreError("INVALID_RECORD");
    if (kind === "contextProduct") {
        const product = s.get("product", String(d.productId)), context = input.contextId ? s.get("context", input.contextId) : null;
        if (!product || !context || product.data.brandId !== context.data.brandId || d.brandId !== context.data.brandId)
            throw new StoreError("INVALID_RECORD");
        if (s.list("contextProduct", input.contextId!).some(r => r.id !== input.id && (r.data.productId === d.productId || r.data.normalizedCode === d.normalizedCode)))
            throw new StoreError("CONFLICT");
    }
    const versionParents: Partial<Record<RecordKind, [
        RecordKind,
        string
    ]>> = { productVersion: ["product", "productId"], contextProductVersion: ["contextProduct", "contextProductId"], retailPriceVersion: ["retailPrice", "priceId"], internalPriceVersion: ["internalPrice", "priceId"] };
    const parent = versionParents[kind];
    if (parent) {
        const row = s.get(parent[0], String(d[parent[1]]));
        if (!row || row.contextId !== input.contextId)
            throw new StoreError("INVALID_RECORD");
        if (s.list(kind).some(r => { const other = r.data as unknown as Record<string, unknown>; return other[parent[1]] === d[parent[1]] && other.sequence === d.sequence; }))
            throw new StoreError("CONFLICT");
        if (d.previousId) {
            const previous = s.get(kind, String(d.previousId));
            if (!previous || (previous.data as unknown as Record<string, unknown>)[parent[1]] !== d[parent[1]])
                throw new StoreError("INVALID_RECORD");
        }
    }
    if (kind === "retailPrice" || kind === "internalPrice") {
        if (s.get("contextProduct", String(d.contextProductId))?.contextId !== input.contextId)
            throw new StoreError("INVALID_RECORD");
        if (s.list(kind).some(r => r.id !== input.id && (r.data as unknown as {
            contextProductId: string;
        }).contextProductId === d.contextProductId))
            throw new StoreError("CONFLICT");
    }
    if (kind === "productUseSnapshot") {
        const cp = s.get("contextProduct", String(d.contextProductId));
        if (!cp || cp.contextId !== input.contextId || cp.data.productId !== d.productId || s.get("productVersion", String(d.productVersionId))?.data.productId !== d.productId || s.get("contextProductVersion", String(d.contextProductVersionId))?.data.contextProductId !== cp.id)
            throw new StoreError("INVALID_RECORD");
    }
}
