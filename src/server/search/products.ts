import { asyncFlatMap } from "@/domain/async-collections";
import type { ProductCommon, ProductContextFields, ProductFileBinding } from '@/domain/products/types';
import type { SearchDocument } from '@/domain/search/types';
import { resolveProduct, productContextScope } from '@/server/products/access';
import { canReferenceFile } from '@/server/files/access';
import { fileUrls } from '@/server/files/service';
import { readProductUse } from '@/server/products/capture';
import { decide } from '@/server/policy/policy';
import { document, field, fields, text, visible, url, type SearchAccess } from './safe';
export function commonFields(c: ProductCommon) { return [...fields(c as unknown as Record<string, unknown>, { name: '상품명', code: '공통 코드', category: '분류', description: '설명', usage: '사용 방법', originCountry: '원산지', manufacturer: '제조사', manufacturingDetails: '제조 정보' }), ...c.localNames.map(n => field(`현지명 (${text(n.language)})`, n.name)), ...fields(c.capacity, { amount: '용량', unit: '단위', raw: '용량 원문' }), ...fields(c.variants, { color: '색상', scent: '향', other: '변형' }), ...fields(c.ingredients, { text: '전성분', language: '전성분 언어', submittedAt: '전성분 제출일', classification: '전성분 분류' }), ...fields(c.packaging, { container: '용기', packaging: '포장', label: '라벨', box: '박스', itf: 'ITF' })]; }
export function localFields(c: ProductContextFields) { return [...fields(c as unknown as Record<string, unknown>, { localName: '현지 상품명', sku: 'SKU', jan: 'JAN', registrationStatus: '등록 상태', salesStatus: '판매 상태' }), ...fields(c.launchDate as unknown as Record<string, unknown>, { value: '출시일', source: '출시일 출처', raw: '출시일 원문' })]; }
async function bindings(a: SearchAccess, productId: string, files: ProductFileBinding[]) {
    const scope = productContextScope(a.contextId, productId);
    return (await asyncFlatMap(files, async (b) => {
        const f = (await a.s.get('fileVersion', b.fileVersionId));
        if (!f || !(await visible(async () => (await canReferenceFile(a.s, a.p, f, scope, a.clock)))))
            return [];
        return [{ binding: b, file: { id: f.id, name: text(f.data.originalName, 240), ...fileUrls(f, { kind: 'product', contextId: a.contextId, productId }) } }];
    }));
}
export async function productDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const cp of (await s.list('contextProduct', contextId))) {
        const r = (await visible(async () => (await resolveProduct(s, p, contextId, cp.data.productId, clock))));
        if (!r)
            continue;
        const pid = r.product.id, link = url(`/products/${pid}`, contextId), local = r.local.data.fields, scope = productContextScope(contextId, pid);
        for (const v of (await s.list('productVersion')).filter(v => v.data.productId === pid)) {
            docs.push((await document(a, 'product', v, pid, v.data.common.name, commonFields(v.data.common), link, { current: v.id === r.common.id, version: v.data.sequence, actor: v.data.changedBy, at: v.data.changedAt, status: v.data.archived ? 'archived' : 'active', statusPrecision: 'historical', productIds: [pid], sku: v.id === r.common.id ? [text(local.sku)] : [], jan: v.id === r.common.id ? [text(local.jan)] : [] })));
        }
        for (const v of (await s.list('contextProductVersion', contextId)).filter(v => v.data.contextProductId === cp.id)) {
            const bs = (await bindings(a, pid, v.data.files)), fs = bs.map(b => b.file);
            docs.push((await document(a, 'product', v, pid, v.data.fields.localName || '컨텍스트 상품 정보', [...localFields(v.data.fields), ...bs.flatMap(b => [field('파일명', b.file.name), ...fields(b.binding as unknown as Record<string, unknown>, { title: '자료 제목', documentType: '문서 유형', issuer: '발급 기관', source: '자료 출처', validityRaw: '유효기간 원문' })])], link, { current: v.id === r.local.id, version: v.data.sequence, at: v.data.changedAt, actor: v.data.changedBy, status: v.data.fields.salesStatus, statusPrecision: 'historical', productIds: [pid], sku: [text(v.data.fields.sku)], jan: [text(v.data.fields.jan)], files: fs })));
        }
        for (const kind of ['retailPrice', 'internalPrice'] as const) {
            if (kind === 'internalPrice' && !(await decide(s, p, 'price.read', { ...scope, requiresInternalPrice: true }, clock)).allowed)
                continue;
            const root = (await s.list(kind, contextId)).find(x => x.data.contextProductId === cp.id);
            if (!root)
                continue;
            for (const v of (await s.list(kind === 'retailPrice' ? 'retailPriceVersion' : 'internalPriceVersion', contextId)).filter(x => x.data.priceId === root.id)) {
                docs.push((await document(a, 'product', v, pid, kind === 'retailPrice' ? '소비자가 기록' : '내부 공급가 기록', fields(v.data.fields as unknown as Record<string, unknown>, { amount: '금액', supplyAmount: '공급가', supplyRate: '공급률', rateBasis: '산정 기준', currency: '통화', effectiveFrom: '적용 시작', effectiveTo: '적용 종료', source: '출처' }), link, { current: v.id === root.data.currentVersionId, version: v.data.sequence, at: v.data.changedAt, actor: v.data.changedBy, productIds: [pid], sku: v.id === root.data.currentVersionId ? [text(local.sku)] : [], jan: v.id === root.data.currentVersionId ? [text(local.jan)] : [] })));
            }
        }
    }
    for (const v of (await s.list('productUseSnapshot', contextId))) {
        const d = (await visible(async () => (await readProductUse(s, p, v.id, clock))));
        if (!d)
            continue;
        const fs = (await bindings(a, d.productId, d.files.map(f => f.binding))).map(f => f.file);
        docs.push((await document(a, 'product', v, d.productId, d.common.name, [...commonFields(d.common), ...localFields(d.context), field('기준일', d.retailSelection.asOfDate), ...fs.map(f => field('파일명', f.name))], url(`/products/${d.productId}`, contextId), { current: false, precision: 'exact_version', actor: v.data.capturedBy, at: d.capturedAt, productIds: [d.productId], taskId: v.data.taskId, sku: [text(d.context.sku)], jan: [text(d.context.jan)], files: fs })));
    }
    return docs;
}
