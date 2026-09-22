import { asyncSome } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { ProductCommon, ProductContextFields, ProductFileBinding, RetailPriceFields, InternalPriceFields } from '@/domain/products/types';
import { blankContext, normalizeProductCode } from '@/domain/products/types';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { productContextScope, resolveProduct } from './access';
import { commonVersion, contextVersion, fresh, newId, provenance, uniqueCode } from './store';
/** Synchronous writers: caller owns the UoW, receipt, and complete audit operation. */
export async function validateProductProject(s: UnitOfWork, p: Principal, contextId: string, fields: ProductContextFields, clock: Clock) {
    if (!fields.projectId)
        return;
    const project = (await s.get('project', fields.projectId));
    if (!project || project.contextId !== contextId || p.user.data.role !== 'gsg' && !(await asyncSome(project.data.taskIds, async (id) => {
        const task = (await s.get('task', id));
        return !!task && (await decide(s, p, 'task.read', taskScope(task), clock)).allowed;
    })))
        unavailable();
}
export async function addProductContext(s: UnitOfWork, p: Principal, clock: Clock, product: StoredRecord<'product'>, contextId: string, common: ProductCommon, fields = blankContext(), source = '사용자 입력') {
    (await authorize(s, p, 'product.edit', productContextScope(contextId, product.id), clock));
    const context = (await s.get('context', contextId));
    if (!context || context.data.brandId !== product.data.brandId)
        unavailable();
    (await uniqueCode(s, contextId, common.code, product.id));
    (await validateProductProject(s, p, contextId, fields, clock));
    const cp = (await s.create('contextProduct', { id: newId(), contextId, data: { productId: product.id, brandId: product.data.brandId!, normalizedCode: normalizeProductCode(common.code), currentVersionId: null } }));
    (await contextVersion(s, p, clock, cp, fields, [], source));
    return cp.id;
}
export async function createProduct(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, brandId: string, common: ProductCommon, fields: ProductContextFields, source = '사용자 입력') {
    (await authorize(s, p, 'product.edit', productContextScope(contextId, 'new-product'), clock));
    const context = (await s.get('context', contextId));
    if (!context?.data.brandId || context.data.brandId !== brandId)
        unavailable();
    (await uniqueCode(s, contextId, common.code));
    const product = (await s.create('product', { id: newId(), contextId: null, data: { schemaVersion: 2, brandId, currentVersionId: null, archivedAt: null, name: common.name, code: common.code, brand: context.data.brand, size: common.capacity.raw, category: common.category, status: 'active', missingMaterials: 0 } }));
    (await commonVersion(s, p, clock, product, common, false, source));
    const contextProductId = (await addProductContext(s, p, clock, product, contextId, common, fields, source));
    return { productId: product.id, contextProductId };
}
export async function updateProductCommon(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, common: ProductCommon, archived: boolean, source = '사용자 입력') {
    const r = (await resolveProduct(s, p, contextId, productId, clock, true));
    fresh(r.product, expectedRevision);
    const relations = (await s.list('contextProduct')).filter(cp => cp.data.productId === productId);
    for (const cp of relations)
        (await uniqueCode(s, cp.contextId!, common.code, productId));
    if (common.code !== r.common.data.common.code)
        for (const cp of relations)
            (await s.update('contextProduct', cp.id, cp.revision, { ...cp.data, normalizedCode: normalizeProductCode(common.code) }));
    return (await commonVersion(s, p, clock, r.product, common, archived, source));
}
export async function updateProductContext(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: ProductContextFields, files: ProductFileBinding[], source = '사용자 입력') {
    const r = (await resolveProduct(s, p, contextId, productId, clock, true));
    fresh(r.relation, expectedRevision);
    (await validateProductProject(s, p, contextId, fields, clock));
    return (await contextVersion(s, p, clock, r.relation, fields, files, source));
}
export async function writeRetailPrice(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: RetailPriceFields, source = '사용자 입력') {
    const r = (await resolveProduct(s, p, contextId, productId, clock, true)), existing = (await s.list('retailPrice', contextId)).find(x => x.data.contextProductId === r.relation.id);
    fresh(existing ?? null, expectedRevision);
    const root = existing ?? (await s.create('retailPrice', { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } }));
    const old = root.data.currentVersionId ? (await s.get('retailPriceVersion', root.data.currentVersionId)) : null;
    const version = (await s.create('retailPriceVersion', { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } }));
    (await s.update('retailPrice', root.id, root.revision, { ...root.data, currentVersionId: version.id }));
    return version;
}
export async function writeInternalPrice(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: InternalPriceFields, source = '사용자 입력') {
    (await authorize(s, p, 'price.read', { ...productContextScope(contextId, productId), requiresInternalPrice: true }, clock));
    const r = (await resolveProduct(s, p, contextId, productId, clock, true)), existing = (await s.list('internalPrice', contextId)).find(x => x.data.contextProductId === r.relation.id);
    fresh(existing ?? null, expectedRevision);
    const root = existing ?? (await s.create('internalPrice', { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } }));
    const old = root.data.currentVersionId ? (await s.get('internalPriceVersion', root.data.currentVersionId)) : null;
    const version = (await s.create('internalPriceVersion', { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } }));
    (await s.update('internalPrice', root.id, root.revision, { ...root.data, currentVersionId: version.id }));
    return version;
}
