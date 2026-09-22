import { asyncSome } from "@/domain/async-collections";
import { draft as storedDraft } from '@/server/corrections/stored';
import { exactTarget } from '@/server/corrections/targets';
import type { SearchDocument } from '@/domain/search/types';
import { correctionTask, canManage } from '@/server/corrections/access';
import { batchDTO, opinionDTO, reviewDTO } from '@/server/corrections/projection';
import { document, field, fields, visible, url, type SearchAccess } from './safe';
export async function correctionDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const t of (await s.list('task', contextId))) {
        if (!(await visible(async () => (await correctionTask(s, p, t.id, clock)))))
            continue;
        const link = url(`/tasks/${t.id}/corrections`, contextId);
        for (const b of (await s.list('correctionBatch', contextId)).filter(b => b.data.taskId === t.id)) {
            const d = (await visible(async () => (await batchDTO(s, p, b, clock))));
            if (!d)
                continue;
            const fs = d.items.flatMap(i => i.source.files.map(f => ({ id: f.id, name: f.name, downloadUrl: f.downloadUrl, previewUrl: f.previewUrl })));
            docs.push((await document(a, 'correction', b, t.id, d.title, [field('요약', d.summary), ...d.items.flatMap(i => fields(i as unknown as Record<string, unknown>, { change: '수정 요청', reason: '이유', publicDescription: '설명', publicSource: '공개 출처', priority: '우선순위' })), ...fs.map(f => field('파일명', f.name))], link, { current: true, version: d.sequence, at: d.publishedAt, actor: d.publishedBy, status: d.mode, statusPrecision: 'historical', taskId: t.id, files: fs })));
            for (const i of d.items) {
                for (const r of i.history.reflections) {
                    const row = (await s.get('correctionReflection', r.id))!;
                    docs.push((await document(a, 'correction', row, t.id, d.title, [field('반영 기록', r.note)], link, { current: false, precision: 'exact_version', at: r.recordedAt, actor: r.recordedBy, status: 'reflected', statusPrecision: 'historical', taskId: t.id })));
                }
                for (const r of i.history.resolutions) {
                    const row = (await s.get('correctionResolution', r.id))!;
                    docs.push((await document(a, 'correction', row, t.id, d.title, [field('해소 판단', r.decision), field('사유', r.reason)], link, { current: false, precision: 'exact_version', at: r.resolvedAt, actor: r.resolvedBy, status: r.decision, statusPrecision: 'historical', taskId: t.id })));
                }
            }
        }
        if (!(await canManage(s, p, t, clock)))
            continue;
        for (const r of (await s.list('correctionDraft', contextId)).filter(r => r.data.taskId === t.id)) {
            const d = storedDraft(r.data.draft);
            if ((await asyncSome(d.items, async (i) => !(await visible(async () => (await exactTarget(s, p, i.target, clock)))))))
                continue;
            docs.push((await document(a, 'correction', r, t.id, d.title, [field('초안 요약', d.summary), ...d.items.flatMap(i => [field('수정 요청', i.change), field('이유', i.reason)])], link, { current: true, at: r.updatedAt, actor: r.data.createdBy, status: r.data.publishedVersionId ? 'published' : 'draft', taskId: t.id })));
        }
        for (const r of (await s.list('correctionOpinionVersion', contextId)).filter(r => r.data.target.taskId === t.id)) {
            const d = (await visible(async () => (await opinionDTO(s, p, r, clock))));
            if (!d)
                continue;
            docs.push((await document(a, 'correction', r, d.opinionId, t.data.title, fields(d as unknown as Record<string, unknown>, { originalText: '원문 의견', receivedOn: '수신일' }), link, { current: (await s.get('correctionOpinion', d.opinionId))?.data.currentVersionId === r.id, version: d.sequence, at: d.recordedAt, actor: d.recordedBy, taskId: t.id })));
        }
        for (const r of (await s.list('correctionReview', contextId)).filter(r => r.data.taskId === t.id)) {
            const d = (await visible(async () => (await reviewDTO(s, p, r, clock))));
            if (!d)
                continue;
            docs.push((await document(a, 'correction', r, t.id, t.data.title, fields(d as unknown as Record<string, unknown>, { result: '검토 판단', rationale: '검토 사유', receivedOn: '수신일' }), link, { current: true, precision: 'exact_version', at: d.recordedAt, actor: d.recordedBy, taskId: t.id })));
        }
    }
    return docs;
}
