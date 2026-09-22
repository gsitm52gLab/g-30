import { resolveVersion } from '@/server/ai-input/access';
import type { SearchDocument } from '@/domain/search/types';
import { analysisDetail } from '@/server/ai-review/read';
import { reviewAccess } from '@/server/ai-review/access';
import { loadCorpus } from '@/server/ai-review/corpus';
import { selectCurrentCorpus } from '@/domain/ai-review/corpus';
import { notificationDTO } from '@/server/notifications/service';
import { providerFields, validateProviderRelations } from '@/server/audit/provider';
import { document, field, visible, url, type SearchAccess } from './safe';
export async function personalDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const r of (await s.list('notification', contextId))) {
        if (r.data.recipientId !== p.user.id)
            continue;
        const d = (await visible(async () => (await notificationDTO(s, p, r, clock))));
        if (!d)
            continue;
        docs.push((await document(a, 'notification', r, r.id, d.title, [field('앱 알림', d.message)], d.actionUrl, { current: true, at: d.deliveredAt, status: d.readAt ? 'read' : 'unread' })));
    }
    if (p.user.data.role !== 'gsg')
        return docs;
    (await reviewAccess(s, p, contextId, clock));
    for (const r of (await s.list('aiVersion', contextId))) {
        const d = (await visible(async () => (await resolveVersion(s, p, r.data.inputId, r.id, clock))));
        if (!d)
            continue;
        docs.push((await document(a, 'analysis', r, d.input.id, d.content.title, [field('입력 본문', d.content.text)], url(`/ai-input/${d.input.id}`, contextId, { version: r.id }), { current: d.input.data.currentVersionId === r.id, version: r.data.sequence, at: r.createdAt, actor: r.data.createdBy, exactSource: true })));
    }
    for (const r of (await s.list('aiAnalysisRun', contextId))) {
        const d = (await visible(async () => (await analysisDetail(s, p, r.id, clock))));
        if (!d)
            continue;
        const values = [field('입력 제목', d.inputTitle), field('실행 상태', d.state)];
        (await validateProviderRelations(s, r));
        if (d.provider) {
            values.push(...providerFields(d.provider));
        }
        if (d.result)
            for (const f of d.result.findings) {
                values.push(field('원문', f.original.quote), field('분석 이유', f.reason), field('수정 제안', f.suggestion), field('위험도', f.risk));
                for (const c of [...f.legalBasis, ...f.supportingGuidance]) {
                    values.push(field('근거 원문', c.excerpt.japanese), field('위치', c.excerpt.locator));
                    if (!d.result.staleExcerptIds.includes(c.excerpt.id) && c.translation)
                        values.push(field('비공식 한국어', c.translation.korean));
                }
                for (const h of f.review.history) {
                    values.push(field('사람 검토 사유', h.reason), field('사람 수정 제안', h.editedSuggestion));
                    const action = (await s.get('aiFindingReviewAction', h.id))!;
                    docs.push((await document(a, 'analysis', action, d.inputId, d.inputTitle, [field('사람 검토', h.decision), field('사유', h.reason), field('수정 제안', h.editedSuggestion)], url(`/ai-review/runs/${r.id}`, contextId), { current: f.review.current?.id === h.id, version: h.sequence, at: h.reviewedAt, actor: action.data.reviewedBy, status: h.decision, statusPrecision: 'historical' })));
                }
            }
        docs.push((await document(a, 'analysis', r, d.inputId, d.inputTitle, values, url(`/ai-review/runs/${r.id}`, contextId), { current: true, precision: 'exact_version', at: d.createdAt, actor: r.data.createdBy, status: d.state, exactSource: true })));
    }
    const current = (await loadCorpus(s));
    for (const row of (await s.list('aiCorpusRelease'))) {
        const release = (await loadCorpus(s, row.id)), selection = selectCurrentCorpus(release, current.sources.map(x => ({ sourceId: x.sourceId, id: x.id, originalHash: x.originalHash }))), values = selection.entries.flatMap(e => [field('근거 제목', e.source.title), field('근거 원문', e.excerpt.japanese), field('근거 위치', e.excerpt.locator), ...e.translation ? [field('비공식 한국어', e.translation.korean)] : []]);
        docs.push((await document(a, 'corpus', row, row.id, `근거 release ${release.id}`, values, url('/ai-review/corpus', contextId, { releaseId: release.id }), { current: release.id === current.id, precision: 'exact_version', at: release.asOf, exactSource: true })));
    }
    return docs;
}
