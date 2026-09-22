import { asyncFilter, asyncMap } from "@/domain/async-collections";
import { auditDetail } from './stored';
import type { StoredRecord } from '@/domain/records';
import type { AuditItem } from '@/domain/audit/view';
import type { SearchDocument } from '@/domain/search/types';
import { decide } from '@/server/policy/policy';
import { productContextScope } from '@/server/products/access';
import { actor, text, time, number, corrupt, type SearchAccess } from '@/server/search/safe';
import { explicitReferences } from './writer';
import { providerAuditItem } from './provider';
const names: Record<string, string> = { 'task.created': '업무 생성', 'task.draft': '업무 초안 저장', 'task.published': '요청 공개', 'task.reassigned': '담당자 변경', 'task.state': '업무 상태 변경', 'task.read': '요청 읽음', 'task.accept': '요청 수락', 'task.schedule': '기한 조정 요청', 'task.schedule_decide': '기한 조정 결정', 'task.manually_completed': 'GSG 수동 완료', 'task.reopened': '업무 재개', 'task.campaign_request': '행사 요청 범위 변경', 'external.action_recorded': '외부 진행 기록', 'completion.followup_linked': '후속 업무 연결', 'product.created': '상품 등록', 'product.save_common': '상품 공통 정보 수정', 'product.save_context': '컨텍스트 상품 정보 수정', 'product.save_files': '상품 자료 연결 변경', 'product.save_retail': '소비자가 기록', 'product.save_internal': '내부 공급가 기록', 'product.archive': '상품 보관', 'product.restore': '상품 복원', 'product.link_context': '상품 컨텍스트 연결', 'product.link_task': '상품 업무 연결', 'product.import': 'Excel 상품 반영', 'import.applied': 'Excel 일괄 반영', 'submission.created': '답변 제출', 'submission.draft_saved': '답변 초안 저장', 'notice.created': '공지 생성', 'notice.draft_saved': '공지 초안 저장', 'notice.published': '공지 공개', 'context.created': '컨텍스트 생성', 'membership.changed': '멤버 권한 변경', 'user.status': '계정 상태 변경', 'invitation.created': '초대 생성', 'invitation.reissued': '초대 재발급', 'invitation.accepted': '초대 수락' };
Object.assign(names, { 'project.created': '프로젝트 생성', 'project.dependencies': '선행 관계 변경', 'template.saved': '템플릿 저장', 'task.acceptance_restored': '수락 상태 복원', 'evidence.register': '증빙 등록', 'evidence.revise': '증빙 버전 추가', 'evidence.link': '증빙 상품 연결', 'evidence.unlink': '증빙 상품 연결 해제', 'evidence.assess': '상품 적용 확인', 'correction.opinion_saved': '검토 의견 저장', 'correction.draft_saved': '수정 취합 초안 저장', 'correction.published': '수정 묶음 공개', 'correction.reflect': '수정 반영 기록', 'correction.resolve': '수정 해소 판단', 'correction.review_recorded': '검토 기록', 'campaign.catalog_saved': '행사 카탈로그 저장', 'campaign.draft_saved': '행사 초안 저장', 'campaign.published': '행사 공개', 'campaign.participate': '행사 참여 응답', 'campaign.external': '행사 외부 진행', 'campaign.physical': '행사 실물 기록', 'campaign.followup': '행사 후속 자료', 'schedule.save': '일정 저장', 'schedule.cancel': '일정 취소', 'schedule.done': '일정 처리 기록', 'schedule.reopen': '일정 재개', 'ai.input.created': 'AI 입력 생성', 'ai.input.revised': 'AI 입력 버전 추가', 'ai.extraction.finished': '입력 읽기 종료', 'ai.analysis.finished': '분석 종료', 'ai.finding.reviewed': '분석 항목 사람 검토', 'inquiry.publish_first': '첫 문의 전송', 'inquiry.question': '질문 추가', 'inquiry.answer': '질문 답변', 'inquiry.supplement': '문의 보완', 'inquiry.message': '문의 메시지', 'inquiry.internal_note': '문의 내부 메모', 'inquiry.state': '질문 상태 변경', 'inquiry.link_task': '문의 업무 연결', 'inquiry.read': '문의 읽음' });
const keyNames: Record<string, string> = { title: '제목', name: '상품명', code: '상품 코드', category: '분류', status: '상태', state: '상태', reason: '사유', revision: '저장 revision', draftRevision: '초안 revision', sequence: '버전 순서', taskCount: '업무 수', count: '개수', assigneeId: '주담당', ownerId: 'GSG 담당', coAssigneeIds: '공동 담당', authorId: '작성자', decision: '결정', effect: '효력', mode: '제출 범위', role: '역할', scope: '권한 범위', internalPriceAccess: '내부 가격 접근', rows: '반영 행 수', visibility: '공개 범위', draftTitle: '초안 제목', draftDescription: '초안 요청 내용', draftBody: '초안 본문', draftRequirementLabels: '초안 요청 항목', sourceName: '원본 파일명', sheetName: '시트명', draftDeadline: '초안 기한', draftDeadlineSource: '초안 기한 출처', draftNarrative: '답변 초안 설명', draftAnswerKeys: '답변 초안 항목' };
async function display(a: SearchAccess, key: string, v: unknown): Promise<string> {
    if (v === null || v === undefined)
        return '기록 없음';
    if (['assigneeId', 'ownerId', 'authorId'].includes(key))
        return (await actor(a, v)).label;
    if (key === 'coAssigneeIds') {
        if (!Array.isArray(v))
            corrupt();
        return (await asyncMap(v, async (x) => (await actor(a, x)).label)).join(', ');
    }
    if (Array.isArray(v)) {
        if (v.some(x => typeof x !== 'string'))
            corrupt();
        return v.map(x => text(x)).join(', ');
    }
    if (typeof v === 'boolean')
        return v ? '예' : '아니요';
    if (typeof v === 'number')
        return String(number(v));
    return text(v);
}
export async function auditItem(a: SearchAccess, row: StoredRecord<'audit'>, docs: SearchDocument[]): Promise<AuditItem | null> {
    const { s, p, clock, contextId } = a, d = row.data;
    if (row.contextId !== contextId && !(row.contextId === null && d.action === 'user.status'))
        return null;
    if (row.contextId === null && !(await decide(s, p, 'account.manage', { kind: 'account', id: d.targetId, contextId: null, visibility: 'internal' }, clock)).allowed)
        return null;
    const canPrice = (await decide(s, p, 'price.read', { ...productContextScope(contextId, 'audit'), requiresInternalPrice: true }, clock)).allowed;
    const action = text(d.action, 120), batchId = typeof d.after?.batchId === 'string' ? d.after.batchId : action === 'import.applied' ? d.targetId : null;
    if (!canPrice && (action === 'product.save_internal' || d.detail?.sensitivity === 'internal_price' || batchId && (await s.get('importBatch', batchId))?.data.includesInternalPrice))
        return null;
    const provider = (await providerAuditItem(a, row, docs));
    if (provider !== undefined)
        return provider;
    const label = names[action];
    if (!label)
        return null;
    const detail = d.detail ? auditDetail(d.detail) : null;
    const refs = detail?.references ?? (await explicitReferences(s, d.before, d.after));
    if (!Array.isArray(refs))
        corrupt();
    const exact = refs.flatMap(r => {
        if (!r || typeof r.kind !== 'string' || typeof r.id !== 'string' || !['before', 'after', 'source'].includes(r.role))
            corrupt();
        const doc = docs.find(x => x.sourceKind === r.kind && x.sourceId === r.id);
        return doc ? [{ label: doc.title + (doc.versionLabel ? ' ' + doc.versionLabel : ''), kind: r.kind, id: r.id, url: doc.historyUrl, role: r.role }] : [];
    });
    const target = docs.find(x => x.rootId === d.targetId && x.isCurrent) ?? docs.find(x => x.rootId === d.targetId || x.sourceId === d.targetId) ?? (exact[0] ? docs.find(x => x.sourceKind === exact[0].kind && x.sourceId === exact[0].id) : null);
    const administrative = ['membership', 'user', 'invitation', 'context'].includes(action.split('.')[0]);
    if (administrative && !(await decide(s, p, row.contextId === null ? 'account.manage' : 'membership.manage', { id: d.targetId, contextId: row.contextId, kind: row.contextId === null ? 'account' : 'membership', visibility: 'internal' }, clock)).allowed)
        return null;
    if (!target && !administrative)
        return null;
    // Protected exact sources must not survive revocation as a countable generic event.
    if (refs.some(r => ['requestVersion', 'submission', 'productUseSnapshot', 'productVersion', 'contextProductVersion', 'retailPriceVersion', 'internalPriceVersion', 'noticeVersion', 'correctionBatch', 'correctionReview', 'correctionOpinionVersion', 'completionSnapshot', 'completionExternalAction', 'scheduleVersion', 'aiAnalysisRun'].includes(r.kind) && !docs.some(x => x.sourceKind === r.kind && x.sourceId === r.id)))
        return null;
    if (d.detail && (d.detail.schemaVersion !== 2 || !['standard', 'internal_price'].includes(d.detail.sensitivity) || !Array.isArray(d.detail.changes)))
        corrupt();
    const changes = (await asyncMap((detail?.changes ?? [...new Set([...Object.keys(d.before), ...Object.keys(d.after)])].filter(k => keyNames[k]).map(key => ({ key, before: d.before[key], after: d.after[key] }))).filter(c => keyNames[c.key]), async (c) => ({ label: keyNames[c.key], before: (await display(a, c.key, c.before)), after: (await display(a, c.key, c.after)) })));
    for (const kind of [...new Set(refs.map(r => r.kind))]) {
        const before = refs.find(r => r.kind === kind && r.role === 'before'), after = refs.find(r => r.kind === kind && r.role === 'after');
        if (!before || !after)
            continue;
        const left = docs.find(d => d.sourceKind === kind && d.sourceId === before.id), right = docs.find(d => d.sourceKind === kind && d.sourceId === after.id);
        if (!left || !right)
            continue;
        const grouped = (d: SearchDocument) => new Map([...new Set(d.fields.map(f => f.label))].map(label => [label, d.fields.filter(f => f.label === label).map(f => f.value).join(' · ')]));
        const l = grouped(left), r = grouped(right);
        for (const label of new Set([...l.keys(), ...r.keys()]))
            if (l.get(label) !== r.get(label))
                changes.push({ label, before: l.get(label) || '기록 없음', after: r.get(label) || '기록 없음' });
    }
    const occurredAt = time(d.at);
    if (!occurredAt)
        corrupt();
    return { id: text(row.id, 160), contextId: row.contextId, action, label, occurredAt, actor: (await actor(a, d.actorId)), target: { id: text(d.targetId, 160), title: target?.title ?? label, url: target?.historyUrl ?? null }, operationId: d.detail ? text(detail!.operationId, 160) : null, receiptId: detail?.receiptId ? text(detail.receiptId, 160) : null, eventIds: (await asyncFilter(refs, async (r) => r.kind === 'domainEvent' && (await s.get('domainEvent', r.id))?.contextId === contextId)).map(r => text(r.id, 160)), correlation: d.detail ? 'recorded' : 'legacy_unavailable', sourcePrecision: exact.length ? 'exact' : d.detail ? 'record_only' : 'legacy_unavailable', changes, versions: exact, fields: changes.map(c => ({ label: c.label, value: `${c.before} → ${c.after}` })), notice: d.detail ? '같은 작업 ID는 하나의 명령 안에서 생성된 기록을 연결합니다. 업무 이벤트와 알림 전달은 별개의 기록입니다.' : '이전 감사 기록입니다. 저장되지 않은 정확한 버전·작업 연결은 추정하지 않습니다.' };
}
