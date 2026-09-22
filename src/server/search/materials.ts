import { assessmentStatuses } from '@/domain/evidence/types';
import { exportShape } from '@/domain/storage/validate';
import { resolveEvidenceVersion, resolveLink } from '@/server/evidence/access';
import type { SearchDocument } from '@/domain/search/types';
import { versionDTO } from '@/server/evidence/projection';
import { batchDTO } from '@/server/imports/projection';
import { productContextScope } from '@/server/products/access';
import { decide } from '@/server/policy/policy';
import { document, field, fields, visible, url, corrupt, type SearchAccess } from './safe';
export async function materialDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const r of (await s.list('evidenceVersion', contextId))) {
        if (!(await visible(async () => (await resolveEvidenceVersion(s, p, r.id, clock)))))
            continue;
        for (const link of (await s.list('evidenceLink', contextId)).filter(l => l.data.evidenceVersionId === r.id))
            (await visible(async () => (await resolveLink(s, p, link.id, clock))));
        const d = (await visible(async () => (await versionDTO(s, p, r.id, clock))));
        if (!d || !d.links.length)
            continue;
        const fs = d.links.map(l => ({ id: l.file.id, name: l.file.name, downloadUrl: l.file.downloadUrl, previewUrl: l.file.previewUrl }));
        docs.push((await document(a, 'evidence', r, d.evidenceId, d.metadata.title, [...fields(r.data.metadata as unknown as Record<string, unknown>, { title: '제목', documentType: '문서 유형', issuer: '발급 기관', issuedAt: '발급일', signedAt: '서명일', statedValidFrom: '명시 시작일', statedValidTo: '명시 종료일', validityRaw: '유효기간 원문', source: '출처' }), ...fs.map(f => field('파일명', f.name))], url('/materials', contextId), { current: (await s.get('evidence', d.evidenceId))?.data.currentVersionId === r.id, version: d.sequence, at: d.recordedAt, actor: r.data.recordedBy, productIds: d.links.map(l => l.productId), files: fs })));
    }
    for (const r of (await s.list('evidenceLink', contextId))) {
        const d = (await visible(async () => (await resolveLink(s, p, r.id, clock))));
        if (!d)
            continue;
        docs.push((await document(a, 'evidence', r, d.version.data.evidenceId, d.version.data.metadata.title, [field('상품 연결', d.product.common.data.common.name), field('연결 상태', r.data.active ? 'active' : 'inactive')], url('/materials', contextId), { current: true, at: r.createdAt, status: r.data.active ? 'active' : 'inactive', productIds: [r.data.productId] })));
        for (const fact of (await s.list('evidenceAssessment', contextId)).filter(x => x.data.linkId === r.id)) {
            if (!assessmentStatuses.includes(fact.data.status))
                corrupt();
            docs.push((await document(a, 'evidence', fact, d.version.data.evidenceId, d.version.data.metadata.title, [field('적용 확인', fact.data.status), field('사유', fact.data.reason)], url('/materials', contextId), { current: r.data.currentAssessmentId === fact.id, version: fact.data.sequence, at: fact.data.assessedAt, actor: fact.data.assessedBy, status: fact.data.status, statusPrecision: 'historical', productIds: [r.data.productId] })));
        }
    }
    for (const r of (await s.list('importBatch', contextId))) {
        if (!(await decide(s, p, 'product.read', productContextScope(contextId, 'import'), clock)).allowed || r.data.includesInternalPrice && !(await decide(s, p, 'price.read', { ...productContextScope(contextId, 'import'), requiresInternalPrice: true }, clock)).allowed)
            continue;
        const d = batchDTO(r);
        docs.push((await document(a, 'import', r, r.id, d.sourceName, [field('파일명', d.sourceName), field('형식', d.schema)], url('/products/import', contextId), { current: true, precision: 'exact_version', at: d.appliedAt, actor: r.data.actorId, status: 'applied', statusPrecision: 'historical', productIds: d.rows.flatMap(r => r.productId ? [r.productId] : []) })));
    }
    for (const r of (await s.list('importExport', contextId))) {
        if (r.data.actorId !== p.user.id || !(await decide(s, p, 'product.read', productContextScope(contextId, 'import'), clock)).allowed || r.data.includeInternal && !(await decide(s, p, 'price.read', { ...productContextScope(contextId, 'import'), requiresInternalPrice: true }, clock)).allowed) continue;
        exportShape(r.data);
        docs.push(await document(a, 'import', r, r.id, r.data.filename, [field('파일명', r.data.filename)], url('/products/import', contextId), { current: false, precision: 'exact_version', at: new Date(r.data.createdAt).toISOString(), actor: r.data.actorId, status: 'exported', statusPrecision: 'historical' }));
    }
    return docs;
}
