import type { StoredRecord, UnitOfWork } from "@/domain/records";
import type { ProductCommon, ProductContextFields, ProductFileBinding } from "@/domain/products/types";
import { blankContext, normalizeProductCode, sharedCommonNotice } from "@/domain/products/types";
import { commonInput, contextInput, bindingsInput, retailInput, internalInput } from "@/domain/products/validate";
import { object, str, enumValue } from "@/domain/tasks/validate";
import { IdentityService, type Principal } from "@/server/auth/service";
import { fail, unavailable } from "@/server/auth/errors";
import { authorize, decide } from "@/server/policy/policy";
import { projectContext, taskScope } from "@/server/policy/projection";
import { canReferenceFile, visibleFile } from "@/server/files/access";
import { resolveProduct, productContextScope, visibleProductRelations } from "./access";
import { productDetail, productItem, visibleContexts } from "./read";
import { commonDTO, commonDiff, contextDTO, bindingDTO } from "./projection";
import { newId, fresh, uniqueCode, receipt, audit, commonVersion, contextVersion, provenance } from "./store";
export interface ProductListQuery {
    context?: string;
    q?: string;
    country?: string;
    retailer?: string;
    brand?: string;
    sku?: string;
    category?: string;
    status?: string;
    page?: string;
    pageSize?: string;
}
function pageNumber(value: string | undefined, fallback: number) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!value.trim() || !Number.isSafeInteger(parsed) || parsed < 1) fail("VALIDATION", 422, "페이지와 페이지 크기를 양의 정수로 지정해 주세요.");
    return parsed;
}
export class ProductService {
    constructor(public identity: IdentityService, private fault?: (command: string) => void) { }
    get clock() { return this.identity.clock; }
    private project(s: UnitOfWork, p: Principal, contextId: string, fields: ProductContextFields) {
        if (fields.projectId) {
            const project = s.get("project", fields.projectId);
            if (!project || project.contextId !== contextId)
                unavailable();
            if (p.user.data.role !== "gsg" && !project.data.taskIds.some(id => { const t = s.get("task", id); return !!t && decide(s, p, "task.read", taskScope(t), this.clock).allowed; }))
                unavailable();
        }
    }
    private bindings(s: UnitOfWork, p: Principal, contextId: string, productId: string, files: ProductFileBinding[]) {
        for (const binding of files) {
            const file = s.get("fileVersion", binding.fileVersionId);
            if (!file)
                unavailable();
            canReferenceFile(s, p, file, productContextScope(contextId, productId), this.clock);
            for (const pid of binding.productIds)
                resolveProduct(s, p, contextId, pid, this.clock);
        }
    }
    private addContext(s: UnitOfWork, p: Principal, product: StoredRecord<"product">, contextId: string, common: ProductCommon, fields = blankContext()) {
        authorize(s, p, "product.edit", productContextScope(contextId, product.id), this.clock);
        const context = s.get("context", contextId);
        if (!context || context.data.brandId !== product.data.brandId)
            unavailable();
        uniqueCode(s, contextId, common.code, product.id);
        this.project(s, p, contextId, fields);
        const cp = s.create("contextProduct", { id: newId(), contextId, data: { productId: product.id, brandId: product.data.brandId!, normalizedCode: normalizeProductCode(common.code), currentVersionId: null } });
        contextVersion(s, p, this.clock, cp, fields, []);
        return cp.id;
    }
    async create(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ["contextId", "brandId", "common", "fields", "idempotencyKey"]), contextId = str(v.contextId, 160, true), brandId = str(v.brandId, 160, true), common = commonInput(v.common), fields = contextInput(v.fields ?? {});
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            authorize(s, p, "product.edit", productContextScope(contextId, "new-product"), this.clock);
            const context = s.get("context", contextId);
            if (!context?.data.brandId || context.data.brandId !== brandId)
                unavailable();
            return receipt(s, p, contextId, "product.create", v, () => {
                uniqueCode(s, contextId, common.code);
                const product = s.create("product", { id: newId(), contextId: null, data: { schemaVersion: 2, brandId, currentVersionId: null, archivedAt: null, name: common.name, code: common.code, brand: context.data.brand, size: common.capacity.raw, category: common.category, status: "active", missingMaterials: 0 } });
                commonVersion(s, p, this.clock, product, common, false);
                const cpId = this.addContext(s, p, product, contextId, common, fields);
                audit(s, p, this.clock, contextId, "product.created", product.id, {}, { name: common.name, code: common.code });
                s.create("domainEvent", { id: newId(), contextId, data: { eventType: "PRODUCT_CREATED", targetId: product.id, sourceVersionId: s.get("product", product.id)!.data.currentVersionId!, actorId: p.user.id, at: this.clock() } });
                return { ids: [product.id, cpId] };
            }, () => this.fault?.("create"));
        });
    }
    async list(token: string | undefined, query: ProductListQuery = {}) {
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            if (query.context)
                authorize(s, p, "product.read", productContextScope(query.context, "products"), this.clock);
            const contexts = s.list("context").filter(c => decide(s, p, "product.read", productContextScope(c.id, "products"), this.clock).allowed).map(projectContext);
            const page = pageNumber(query.page, 1), pageSize = Math.min(100, pageNumber(query.pageSize, 24)), search = (query.q ?? "").trim().toLocaleLowerCase();
            const rows = visibleProductRelations(s, p, this.clock, query.context).map(cp => resolveProduct(s, p, cp.contextId!, cp.data.productId, this.clock)).map(r => productItem(s, p, r, this.clock)).filter(item => {
                const c = item.context.data;
                const statusMatches = !query.status || (query.status === "archived" ? item.archived : !item.archived && item.local.salesStatus === query.status);
                return (!query.country || c.countryId === query.country) && (!query.retailer || c.retailerId === query.retailer) && (!query.brand || c.brandId === query.brand) && (!query.category || item.common.category === query.category) && (!query.sku || item.local.sku.toLocaleLowerCase().includes(query.sku.toLocaleLowerCase())) && statusMatches && (!search || [item.common.name, item.common.code, item.local.localName, item.local.sku, item.local.jan, ...item.common.localNames.map(n => n.name)].some(v => v.toLocaleLowerCase().includes(search)));
            }).sort((a, b) => a.common.name.localeCompare(b.common.name) || a.contextProductId.localeCompare(b.contextProductId));
            return { mode: this.identity.repo.mode, contexts, items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, materialCounts: { connected: false as const, requested: null, missing: null, unconfirmed: null } };
        });
    }
    async detail(token: string | undefined, productId: string, contextId: string) { return this.identity.repo.transaction(s => productDetail(s, this.identity.principal(s, token), resolveProduct(s, this.identity.principal(s, token), contextId, productId, this.clock), this.clock)); }
    async impact(token: string | undefined, productId: string, input: Record<string, unknown>) {
        const v = object(input, ["contextId", "common", "expectedCommonRevision"]), contextId = str(v.contextId, 160, true), next = commonInput(v.common);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), r = resolveProduct(s, p, contextId, productId, this.clock, true);
            fresh(r.product, v.expectedCommonRevision);
            return { productId, commonRevision: r.product.revision, sharedCommonNotice, visibleContexts: visibleContexts(s, p, r, this.clock), changes: commonDiff(r.common.data.common, next) };
        });
    }
    async command(token: string | undefined, productId: string, input: Record<string, unknown>) {
        const contextId = str(input.contextId, 160, true), command = enumValue(input.command, ["save_common", "save_context", "save_files", "save_retail", "save_internal", "archive", "restore", "link_context", "link_task"]);
        const allowed: Record<typeof command, string[]> = { save_common: ["common", "expectedCommonRevision"], save_context: ["fields", "expectedContextRevision"], save_files: ["files", "expectedContextRevision"], save_retail: ["price", "expectedPriceRevision"], save_internal: ["price", "expectedPriceRevision"], archive: ["expectedCommonRevision"], restore: ["expectedCommonRevision"], link_context: ["targetContextId", "expectedCommonRevision"], link_task: ["taskId", "expectedTaskRevision"] };
        const v = object(input, ["contextId", "command", "idempotencyKey", ...allowed[command]]);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), r = resolveProduct(s, p, contextId, productId, this.clock, true);
            if (command === "save_files")
                this.bindings(s, p, contextId, productId, bindingsInput(v.files));
            if (command === "save_internal")
                authorize(s, p, "price.read", { ...productContextScope(contextId, productId), requiresInternalPrice: true }, this.clock);
            if (command === "link_task") {
                const task = s.get("task", str(v.taskId, 160, true));
                if (!task || task.contextId !== contextId)
                    unavailable();
                authorize(s, p, "task.manage", taskScope(task), this.clock);
            }
            if (command === "link_context")
                authorize(s, p, "product.edit", productContextScope(str(v.targetContextId, 160, true), productId), this.clock);
            return receipt(s, p, contextId, `product.${productId}.${command}`, v, () => {
                let versionId: string | null = null;
                if (command === "save_common" || command === "archive" || command === "restore") {
                    fresh(r.product, v.expectedCommonRevision);
                    const common = command === "save_common" ? commonInput(v.common) : commonDTO(r.common.data.common);
                    const relations = s.list("contextProduct").filter(cp => cp.data.productId === productId);
                    for (const cp of relations)
                        uniqueCode(s, cp.contextId!, common.code, productId);
                    if (common.code !== r.common.data.common.code)
                        for (const cp of relations)
                            s.update("contextProduct", cp.id, cp.revision, { ...cp.data, normalizedCode: normalizeProductCode(common.code) });
                    versionId = commonVersion(s, p, this.clock, r.product, common, command === "archive" || command !== "restore" && r.common.data.archived).id;
                }
                else if (command === "save_context" || command === "save_files") {
                    fresh(r.relation, v.expectedContextRevision);
                    const fields = command === "save_context" ? contextInput(v.fields) : contextDTO(r.local.data.fields);
                    let files = r.local.data.files.map(bindingDTO);
                    if (command === "save_files") {
                        const submitted = bindingsInput(v.files);
                        this.bindings(s, p, contextId, productId, submitted);
                        const hidden = files.filter(binding => { const f = s.get("fileVersion", binding.fileVersionId); return !f || !visibleFile(s, p, f, productContextScope(contextId, productId), this.clock); });
                        if (submitted.some(binding => hidden.some(old => old.id === binding.id)))
                            unavailable();
                        files = [...hidden, ...submitted];
                    }
                    this.project(s, p, contextId, fields);
                    versionId = contextVersion(s, p, this.clock, r.relation, fields, files).id;
                }
                else if (command === "save_retail") {
                    const fields = retailInput(v.price), existing = s.list("retailPrice", contextId).find(x => x.data.contextProductId === r.relation.id);
                    fresh(existing ?? null, v.expectedPriceRevision);
                    const root = existing ?? s.create("retailPrice", { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } }), old = root.data.currentVersionId ? s.get("retailPriceVersion", root.data.currentVersionId) : null;
                    const version = s.create("retailPriceVersion", { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, this.clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null) } });
                    s.update("retailPrice", root.id, root.revision, { ...root.data, currentVersionId: version.id });
                    versionId = version.id;
                }
                else if (command === "save_internal") {
                    const fields = internalInput(v.price), existing = s.list("internalPrice", contextId).find(x => x.data.contextProductId === r.relation.id);
                    fresh(existing ?? null, v.expectedPriceRevision);
                    const root = existing ?? s.create("internalPrice", { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } }), old = root.data.currentVersionId ? s.get("internalPriceVersion", root.data.currentVersionId) : null;
                    const version = s.create("internalPriceVersion", { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, this.clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null) } });
                    s.update("internalPrice", root.id, root.revision, { ...root.data, currentVersionId: version.id });
                    versionId = version.id;
                }
                else if (command === "link_context") {
                    fresh(r.product, v.expectedCommonRevision);
                    if (r.common.data.archived)
                        fail("VALIDATION", 422, "보관한 상품은 복원한 뒤 연결해 주세요.");
                    const target = str(v.targetContextId, 160, true);
                    versionId = this.addContext(s, p, r.product, target, commonDTO(r.common.data.common));
                }
                else if (command === "link_task") {
                    if (r.common.data.archived)
                        fail("VALIDATION", 422, "보관한 상품은 복원한 뒤 연결해 주세요.");
                    const task = s.get("task", str(v.taskId, 160, true))!;
                    fresh(task, v.expectedTaskRevision);
                    if (!task.data.productIds.includes(productId))
                        s.update("task", task.id, task.revision, { ...task.data, productIds: [...task.data.productIds, productId] });
                    versionId = task.id;
                }
                audit(s, p, this.clock, contextId, `product.${command}`, productId, {}, { versionId });
                s.create("domainEvent", { id: newId(), contextId, data: { eventType: `PRODUCT_${command.toUpperCase()}`, targetId: productId, sourceVersionId: versionId, actorId: p.user.id, at: this.clock() } });
                return { ids: [productId, ...versionId ? [versionId] : []] };
            }, () => this.fault?.(command));
        });
    }
}
export type ProductList = Awaited<ReturnType<ProductService["list"]>>;
export type ProductDetail = Awaited<ReturnType<ProductService["detail"]>>;
export type ProductImpact = Awaited<ReturnType<ProductService["impact"]>>;
