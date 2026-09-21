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
export function validateProductProject(s: UnitOfWork, p: Principal, contextId: string, fields: ProductContextFields, clock: Clock) {
    if (!fields.projectId)
        return;
    const project = s.get('project', fields.projectId);
    if (!project || project.contextId !== contextId || p.user.data.role !== 'gsg' && !project.data.taskIds.some(id => {
        const task = s.get('task', id);
        return !!task && decide(s, p, 'task.read', taskScope(task), clock).allowed;
    }))
        unavailable();
}
export function addProductContext(s: UnitOfWork, p: Principal, clock: Clock, product: StoredRecord<'product'>, contextId: string, common: ProductCommon, fields = blankContext(), source = '사용자 입력') {
    authorize(s, p, 'product.edit', productContextScope(contextId, product.id), clock);
    const context = s.get('context', contextId);
    if (!context || context.data.brandId !== product.data.brandId)
        unavailable();
    uniqueCode(s, contextId, common.code, product.id);
    validateProductProject(s, p, contextId, fields, clock);
    const cp = s.create('contextProduct', { id: newId(), contextId, data: { productId: product.id, brandId: product.data.brandId!, normalizedCode: normalizeProductCode(common.code), currentVersionId: null } });
    contextVersion(s, p, clock, cp, fields, [], source);
    return cp.id;
}
export function createProduct(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, brandId: string, common: ProductCommon, fields: ProductContextFields, source = '사용자 입력') {
    authorize(s, p, 'product.edit', productContextScope(contextId, 'new-product'), clock);
    const context = s.get('context', contextId);
    if (!context?.data.brandId || context.data.brandId !== brandId)
        unavailable();
    uniqueCode(s, contextId, common.code);
    const product = s.create('product', { id: newId(), contextId: null, data: { schemaVersion: 2, brandId, currentVersionId: null, archivedAt: null, name: common.name, code: common.code, brand: context.data.brand, size: common.capacity.raw, category: common.category, status: 'active', missingMaterials: 0 } });
    commonVersion(s, p, clock, product, common, false, source);
    const contextProductId = addProductContext(s, p, clock, product, contextId, common, fields, source);
    return { productId: product.id, contextProductId };
}
export function updateProductCommon(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, common: ProductCommon, archived: boolean, source = '사용자 입력') {
    const r = resolveProduct(s, p, contextId, productId, clock, true);
    fresh(r.product, expectedRevision);
    const relations = s.list('contextProduct').filter(cp => cp.data.productId === productId);
    for (const cp of relations)
        uniqueCode(s, cp.contextId!, common.code, productId);
    if (common.code !== r.common.data.common.code)
        for (const cp of relations)
            s.update('contextProduct', cp.id, cp.revision, { ...cp.data, normalizedCode: normalizeProductCode(common.code) });
    return commonVersion(s, p, clock, r.product, common, archived, source);
}
export function updateProductContext(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: ProductContextFields, files: ProductFileBinding[], source = '사용자 입력') {
    const r = resolveProduct(s, p, contextId, productId, clock, true);
    fresh(r.relation, expectedRevision);
    validateProductProject(s, p, contextId, fields, clock);
    return contextVersion(s, p, clock, r.relation, fields, files, source);
}
export function writeRetailPrice(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: RetailPriceFields, source = '사용자 입력') {
    const r = resolveProduct(s, p, contextId, productId, clock, true), existing = s.list('retailPrice', contextId).find(x => x.data.contextProductId === r.relation.id);
    fresh(existing ?? null, expectedRevision);
    const root = existing ?? s.create('retailPrice', { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } });
    const old = root.data.currentVersionId ? s.get('retailPriceVersion', root.data.currentVersionId) : null;
    const version = s.create('retailPriceVersion', { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } });
    s.update('retailPrice', root.id, root.revision, { ...root.data, currentVersionId: version.id });
    return version;
}
export function writeInternalPrice(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, productId: string, expectedRevision: unknown, fields: InternalPriceFields, source = '사용자 입력') {
    authorize(s, p, 'price.read', { ...productContextScope(contextId, productId), requiresInternalPrice: true }, clock);
    const r = resolveProduct(s, p, contextId, productId, clock, true), existing = s.list('internalPrice', contextId).find(x => x.data.contextProductId === r.relation.id);
    fresh(existing ?? null, expectedRevision);
    const root = existing ?? s.create('internalPrice', { id: newId(), contextId, data: { contextProductId: r.relation.id, currentVersionId: null } });
    const old = root.data.currentVersionId ? s.get('internalPriceVersion', root.data.currentVersionId) : null;
    const version = s.create('internalPriceVersion', { id: newId(), contextId, data: { priceId: root.id, fields, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } });
    s.update('internalPrice', root.id, root.revision, { ...root.data, currentVersionId: version.id });
    return version;
}
