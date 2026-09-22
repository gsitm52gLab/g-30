import { asyncFilter, asyncMap } from "@/domain/async-collections";
import type { UnitOfWork } from "@/domain/records";
import type { ProductFileBinding } from "@/domain/products/types";
import { sharedCommonNotice } from "@/domain/products/types";
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
import { newId, fresh, receipt, audit } from "./store";
import { addProductContext, createProduct, updateProductCommon, updateProductContext, writeRetailPrice, writeInternalPrice } from "./mutations";
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
    if (value === undefined)
        return fallback;
    const parsed = Number(value);
    if (!value.trim() || !Number.isSafeInteger(parsed) || parsed < 1)
        fail("VALIDATION", 422, "페이지와 페이지 크기를 양의 정수로 지정해 주세요.");
    return parsed;
}
export class ProductService {
    constructor(public identity: IdentityService, private fault?: (command: string) => void) { }
    get clock() { return this.identity.clock; }
    private async bindings(s: UnitOfWork, p: Principal, contextId: string, productId: string, files: ProductFileBinding[]) {
        for (const binding of files) {
            const file = (await s.get("fileVersion", binding.fileVersionId));
            if (!file)
                unavailable();
            (await canReferenceFile(s, p, file, productContextScope(contextId, productId), this.clock));
            for (const pid of binding.productIds)
                (await resolveProduct(s, p, contextId, pid, this.clock));
        }
    }
    async create(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ["contextId", "brandId", "common", "fields", "idempotencyKey"]), contextId = str(v.contextId, 160, true), brandId = str(v.brandId, 160, true), common = commonInput(v.common), fields = contextInput(v.fields ?? {});
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            (await authorize(s, p, "product.edit", productContextScope(contextId, "new-product"), this.clock));
            const context = (await s.get("context", contextId));
            if (!context?.data.brandId || context.data.brandId !== brandId)
                unavailable();
            return (await receipt(s, p, contextId, "product.create", v, async () => {
                const result = (await createProduct(s, p, this.clock, contextId, brandId, common, fields)), product = (await s.get("product", result.productId))!, cpId = result.contextProductId;
                const auditEvent = (await s.create("domainEvent", { id: newId(), contextId, data: { eventType: "PRODUCT_CREATED", targetId: product.id, sourceVersionId: (await s.get("product", product.id))!.data.currentVersionId!, actorId: p.user.id, at: this.clock() } }));
                (await audit(s, p, this.clock, contextId, "product.created", product.id, {}, { name: common.name, code: common.code, commonVersionId: product.data.currentVersionId, contextVersionId: (await s.get("contextProduct", cpId))!.data.currentVersionId }, { references: [{ kind: 'domainEvent', id: auditEvent.id, role: 'source' }] }));
                return { ids: [product.id, cpId] };
            }, () => this.fault?.("create")));
        });
    }
    async list(token: string | undefined, query: ProductListQuery = {}) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            if (query.context)
                (await authorize(s, p, "product.read", productContextScope(query.context, "products"), this.clock));
            const contexts = (await asyncFilter((await s.list("context")), async (c) => (await decide(s, p, "product.read", productContextScope(c.id, "products"), this.clock)).allowed)).map(projectContext);
            const page = pageNumber(query.page, 1), pageSize = Math.min(100, pageNumber(query.pageSize, 24)), search = (query.q ?? "").trim().toLocaleLowerCase();
            const rows = (await asyncMap((await asyncMap((await visibleProductRelations(s, p, this.clock, query.context)), async (cp) => (await resolveProduct(s, p, cp.contextId!, cp.data.productId, this.clock)))), async (r) => (await productItem(s, p, r, this.clock)))).filter(item => {
                const c = item.context.data;
                const statusMatches = !query.status || (query.status === "archived" ? item.archived : !item.archived && item.local.salesStatus === query.status);
                return (!query.country || c.countryId === query.country) && (!query.retailer || c.retailerId === query.retailer) && (!query.brand || c.brandId === query.brand) && (!query.category || item.common.category === query.category) && (!query.sku || item.local.sku.toLocaleLowerCase().includes(query.sku.toLocaleLowerCase())) && statusMatches && (!search || [item.common.name, item.common.code, item.local.localName, item.local.sku, item.local.jan, ...item.common.localNames.map(n => n.name)].some(v => v.toLocaleLowerCase().includes(search)));
            }).sort((a, b) => a.common.name.localeCompare(b.common.name) || a.contextProductId.localeCompare(b.contextProductId));
            return { mode: this.identity.repo.mode, contexts, items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, materialCounts: { connected: true as const, requested: rows.reduce((n, r) => n + r.materialCounts.requested, 0), missing: rows.reduce((n, r) => n + r.materialCounts.missing, 0), unconfirmed: rows.reduce((n, r) => n + r.materialCounts.unconfirmed, 0) } };
        });
    }
    async detail(token: string | undefined, productId: string, contextId: string) { return this.identity.repo.transaction(async (s) => (await productDetail(s, (await this.identity.principal(s, token)), (await resolveProduct(s, (await this.identity.principal(s, token)), contextId, productId, this.clock)), this.clock))); }
    async impact(token: string | undefined, productId: string, input: Record<string, unknown>) {
        const v = object(input, ["contextId", "common", "expectedCommonRevision"]), contextId = str(v.contextId, 160, true), next = commonInput(v.common);
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolveProduct(s, p, contextId, productId, this.clock, true));
            fresh(r.product, v.expectedCommonRevision);
            return { productId, commonRevision: r.product.revision, sharedCommonNotice, visibleContexts: (await visibleContexts(s, p, r, this.clock)), changes: commonDiff(r.common.data.common, next) };
        });
    }
    async command(token: string | undefined, productId: string, input: Record<string, unknown>) {
        const contextId = str(input.contextId, 160, true), command = enumValue(input.command, ["save_common", "save_context", "save_files", "save_retail", "save_internal", "archive", "restore", "link_context", "link_task"]);
        const allowed: Record<typeof command, string[]> = { save_common: ["common", "expectedCommonRevision"], save_context: ["fields", "expectedContextRevision"], save_files: ["files", "expectedContextRevision"], save_retail: ["price", "expectedPriceRevision"], save_internal: ["price", "expectedPriceRevision"], archive: ["expectedCommonRevision"], restore: ["expectedCommonRevision"], link_context: ["targetContextId", "expectedCommonRevision"], link_task: ["taskId", "expectedTaskRevision"] };
        const v = object(input, ["contextId", "command", "idempotencyKey", ...allowed[command]]);
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolveProduct(s, p, contextId, productId, this.clock, true));
            if (command === "save_files")
                (await this.bindings(s, p, contextId, productId, bindingsInput(v.files)));
            if (command === "save_internal")
                (await authorize(s, p, "price.read", { ...productContextScope(contextId, productId), requiresInternalPrice: true }, this.clock));
            if (command === "link_task") {
                const task = (await s.get("task", str(v.taskId, 160, true)));
                if (!task || task.contextId !== contextId)
                    unavailable();
                (await authorize(s, p, "task.manage", taskScope(task), this.clock));
            }
            if (command === "link_context")
                (await authorize(s, p, "product.edit", productContextScope(str(v.targetContextId, 160, true), productId), this.clock));
            return (await receipt(s, p, contextId, `product.${productId}.${command}`, v, async () => {
                let versionId: string | null = null;
                const previousVersionId = ["save_common", "archive", "restore"].includes(command) ? r.common.id : ["save_context", "save_files"].includes(command) ? r.local.id : command === "save_retail" || command === "save_internal" ? (await s.list(command === "save_retail" ? "retailPrice" : "internalPrice", contextId)).find(x => x.data.contextProductId === r.relation.id)?.data.currentVersionId ?? null : null;
                if (command === "save_common" || command === "archive" || command === "restore") {
                    fresh(r.product, v.expectedCommonRevision);
                    const common = command === "save_common" ? commonInput(v.common) : commonDTO(r.common.data.common);
                    versionId = (await updateProductCommon(s, p, this.clock, contextId, productId, v.expectedCommonRevision, common, command === "archive" || command !== "restore" && r.common.data.archived)).id;
                }
                else if (command === "save_context" || command === "save_files") {
                    fresh(r.relation, v.expectedContextRevision);
                    const fields = command === "save_context" ? contextInput(v.fields) : contextDTO(r.local.data.fields);
                    let files = r.local.data.files.map(bindingDTO);
                    if (command === "save_files") {
                        const submitted = bindingsInput(v.files);
                        (await this.bindings(s, p, contextId, productId, submitted));
                        const hidden = (await asyncFilter(files, async (binding) => { const f = (await s.get("fileVersion", binding.fileVersionId)); return !f || !(await visibleFile(s, p, f, productContextScope(contextId, productId), this.clock)); }));
                        if (submitted.some(binding => hidden.some(old => old.id === binding.id)))
                            unavailable();
                        files = [...hidden, ...submitted];
                    }
                    versionId = (await updateProductContext(s, p, this.clock, contextId, productId, v.expectedContextRevision, fields, files)).id;
                }
                else if (command === "save_retail") {
                    versionId = (await writeRetailPrice(s, p, this.clock, contextId, productId, v.expectedPriceRevision, retailInput(v.price))).id;
                }
                else if (command === "save_internal") {
                    versionId = (await writeInternalPrice(s, p, this.clock, contextId, productId, v.expectedPriceRevision, internalInput(v.price))).id;
                }
                else if (command === "link_context") {
                    fresh(r.product, v.expectedCommonRevision);
                    if (r.common.data.archived)
                        fail("VALIDATION", 422, "보관한 상품은 복원한 뒤 연결해 주세요.");
                    const target = str(v.targetContextId, 160, true);
                    versionId = (await addProductContext(s, p, this.clock, r.product, target, commonDTO(r.common.data.common)));
                }
                else if (command === "link_task") {
                    if (r.common.data.archived)
                        fail("VALIDATION", 422, "보관한 상품은 복원한 뒤 연결해 주세요.");
                    const task = (await s.get("task", str(v.taskId, 160, true)))!;
                    fresh(task, v.expectedTaskRevision);
                    if (!task.data.productIds.includes(productId))
                        (await s.update("task", task.id, task.revision, { ...task.data, productIds: [...task.data.productIds, productId] }));
                    versionId = task.id;
                }
                const auditEvent = (await s.create("domainEvent", { id: newId(), contextId, data: { eventType: `PRODUCT_${command.toUpperCase()}`, targetId: productId, sourceVersionId: versionId, actorId: p.user.id, at: this.clock() } }));
                (await audit(s, p, this.clock, contextId, `product.${command}`, productId, { versionId: previousVersionId }, { versionId }, { references: [{ kind: 'domainEvent', id: auditEvent.id, role: 'source' }] }));
                return { ids: [productId, ...versionId ? [versionId] : []] };
            }, () => this.fault?.(command)));
        });
    }
}
export type ProductList = Awaited<ReturnType<ProductService["list"]>>;
export type ProductDetail = Awaited<ReturnType<ProductService["detail"]>>;
export type ProductImpact = Awaited<ReturnType<ProductService["impact"]>>;
