import type { SearchDocument } from '@/domain/search/types';
import { snapshotDTO, externalDTO, reopenDTO, followupDTO } from '@/server/completion/projection';
import { manualVersionDTO } from '@/server/scheduling/manual';
import { versionDTO as campaignVersion, selectionDTO, catalogDTO } from '@/server/campaigns/projection';
import { manageCatalog } from '@/server/campaigns/access';
import { campaignDetail } from '@/server/campaigns/read';
import { document, field, fields, visible, url, type SearchAccess } from './safe';
export async function operationDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const r of (await s.list('completionSnapshot', contextId))) {
        const d = (await visible(async () => (await snapshotDTO(s, p, r, clock))));
        if (!d)
            continue;
        docs.push((await document(a, 'completion', r, d.taskId, '업무 수동 완료', [field('완료 메모', d.memo), field('완료 전 상태', d.statusBefore)], url(`/tasks/${d.taskId}/completion`, contextId), { current: false, version: d.sequence, at: d.completedAt, actor: r.data.completedBy, status: 'completed', statusPrecision: 'historical', taskId: d.taskId })));
    }
    for (const r of (await s.list('completionExternalAction', contextId))) {
        const d = (await visible(async () => (await externalDTO(s, p, r, clock))));
        if (!d)
            continue;
        const fs = [...d.source.files, ...d.evidenceFiles].map(f => ({ id: f.id, name: f.name, downloadUrl: f.downloadUrl, previewUrl: f.previewUrl }));
        docs.push((await document(a, 'completion', r, d.taskId, d.purpose, [field('목적', d.purpose), field('진행', d.latestProgress), field('전달처', d.destination), field('효력', '진행 기록 · 자동 완료 아님'), ...fs.map(f => field('파일명', f.name))], url(`/tasks/${d.taskId}/completion`, contextId), { current: true, version: d.sequence, at: d.recordedAt, actor: r.data.recordedBy, status: d.waitingExternal ? 'external_waiting' : 'recorded', statusPrecision: 'historical', taskId: d.taskId, files: fs })));
    }
    for (const r of (await s.list('completionReopen', contextId))) {
        const d = (await visible(async () => (await reopenDTO(s, p, r, clock))));
        if (d)
            docs.push((await document(a, 'completion', r, r.data.taskId, '업무 재개', [field('재개 사유', d.reason)], url(`/tasks/${r.data.taskId}/completion`, contextId), { current: false, precision: 'exact_version', at: d.reopenedAt, actor: r.data.reopenedBy, status: d.resumedStatus, statusPrecision: 'historical', taskId: r.data.taskId })));
    }
    for (const r of (await s.list('completionFollowup', contextId))) {
        const d = (await visible(async () => (await followupDTO(s, p, r, clock))));
        if (d)
            docs.push((await document(a, 'completion', r, r.data.taskId, '후속 업무 연결', [field('후속 업무', d.title), field('연결 사유', d.reason)], url(`/tasks/${r.data.taskId}/completion`, contextId), { current: true, precision: 'exact_version', at: d.linkedAt, actor: r.data.linkedBy, taskId: r.data.taskId })));
    }
    for (const r of (await s.list('scheduleVersion', contextId))) {
        const d = (await visible(async () => (await manualVersionDTO(s, p, r.data.scheduleId, clock, r))));
        if (!d)
            continue;
        docs.push((await document(a, 'schedule', r, r.data.scheduleId, d.content.title, [field('일정 종류', d.content.kind), field('기한', d.content.deadline.value), field('기한 원문', d.content.deadline.raw), field('출처', d.content.deadline.source), field('확실성', d.content.deadline.certainty), field('변경 사유', d.reason), ...d.content.conflicts.flatMap(c => fields(c as unknown as Record<string, unknown>, { source: '충돌 출처', raw: '충돌 원문', reason: '충돌 사유', state: '충돌 상태' }))], url(`/schedule/${r.data.scheduleId}`, contextId), { current: (await s.get('schedule', r.data.scheduleId))?.data.currentVersionId === r.id, version: d.sequence, at: d.changedAt, actor: r.data.changedBy, status: d.state, statusPrecision: 'historical', taskId: d.content.taskId })));
    }
    if (p.user.data.role === 'gsg' && (await visible(async () => { (await manageCatalog(s, p, contextId, clock)); return true; }))) {
        for (const r of (await s.list('campaignCatalogVersion', contextId))) {
            const c = (await catalogDTO(s, p, r, clock));
            docs.push((await document(a, 'campaign', r, c.catalogId, c.title, [field('원문', c.source.originalText), field('번역', c.source.translatedText), field('출처', c.source.source), field('출처 버전', c.source.sourceVersion), field('위치', c.source.locator)], url('/tasks', contextId), { current: (await s.get('campaignCatalog', c.catalogId))?.data.currentVersionId === r.id, version: c.sequence, at: c.recordedAt, actor: r.data.recordedBy })));
        }
        for (const r of (await s.list('campaign', contextId))) {
            const c = (await visible(async () => (await campaignDetail(s, p, r.id, clock))));
            if (!c?.staff?.draft)
                continue;
            const draft = c.staff.draft;
            docs.push((await document(a, 'campaign', r, r.id, draft.title, draft.menus.flatMap(m => [field('메뉴', m.identity.menuName), ...m.sourceStatements.flatMap(x => [field('원문', x.source.originalText), field('기재값', x.rawValue)]), ...m.conflicts.map(x => field('확인 결과', x.resolution))]), url(`/tasks/${c.taskId}/campaigns`, contextId, { campaign: r.id }), { current: true, at: r.updatedAt, actor: r.data.createdBy, taskId: c.taskId, status: 'draft' })));
        }
    }
    for (const r of (await s.list('campaignVersion', contextId))) {
        const d = (await visible(async () => (await campaignVersion(s, p, r, clock))));
        if (!d)
            continue;
        const link = url(`/tasks/${d.taskId}/campaigns`, contextId, { campaign: d.campaignId, version: r.id });
        docs.push((await document(a, 'campaign', r, d.campaignId, d.title, [...d.menus.flatMap(m => [field('메뉴', m.identity.menuName), field('공개 설명', m.conditions.publicExplanation), field('취소 조건', m.conditions.cancellationTerms), field('자료 요청', m.request.description)])], link, { current: (await s.get('campaign', d.campaignId))?.data.currentVersionId === r.id, version: d.sequence, at: d.recordedAt, actor: r.data.recordedBy, taskId: d.taskId, exactSource: true })));
        const detail = (await visible(async () => (await campaignDetail(s, p, d.campaignId, clock, r.id))));
        if (!detail)
            continue;
        for (const sel of (await s.list('campaignSelection', contextId)).filter(v => v.data.campaignVersionId === r.id)) {
            const v = (await selectionDTO(s, p, sel));
            docs.push((await document(a, 'campaign', sel, d.campaignId, d.title, [field('참여 응답', v.response), field('참여 메모', v.note)], link, { current: false, version: v.sequence, at: v.recordedAt, actor: sel.data.recordedBy, status: v.response, statusPrecision: 'historical', taskId: d.taskId })));
        }
        for (const x of detail.external) {
            const row = (await s.get('campaignExternalFact', x.id))!;
            docs.push((await document(a, 'campaign', row, d.campaignId, d.title, [field('외부 진행', x.value), field('메모', x.note)], link, { current: true, version: x.sequence, at: x.recordedAt, actor: row.data.recordedBy, taskId: d.taskId })));
        }
        for (const m of detail.progress)
            for (const ph of m.physical)
                for (const x of ph.facts) {
                    const row = (await s.get('campaignPhysicalFact', x.id))!;
                    docs.push((await document(a, 'campaign', row, d.campaignId, d.title, fields(x as unknown as Record<string, unknown>, { note: '실물 메모', quantity: '수량', trackingNumber: '송장', destination: '목적지', kind: '기록 구분' }), link, { current: true, version: x.sequence, at: x.recordedAt, actor: row.data.recordedBy, taskId: d.taskId })));
                }
        for (const m of detail.progress)
            for (const follow of m.followups)
                for (const x of follow.facts) {
                    const row = (await s.get('campaignFollowupFact', x.id))!;
                    docs.push((await document(a, 'campaign', row, d.campaignId, d.title, [field('후속 자료 메모', x.note), field('정확 제출 버전', x.source.submissionId)], link, { current: true, version: x.sequence, at: x.recordedAt, actor: row.data.recordedBy, taskId: d.taskId })));
                }
    }
    return docs;
}
