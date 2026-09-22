import { asyncForEach } from "@/domain/async-collections";
import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { CampaignDraft, CampaignProduct, SubmittedReference, MenuDraft, PublicMenu, MenuIdentity } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { fail, unavailable } from '@/server/auth/errors';
import { canReferenceFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { authorize, activeMember, canAdmin } from '@/server/policy/policy';
import { resolveProduct } from '@/server/products/access';
import { readProductUse } from '@/server/products/capture';
import { snapshotDTO } from '@/server/submissions/read';
import { answerFiles } from '@/domain/submissions/files';
import { compatibleRequirement } from '@/domain/submissions/evaluate';
import { campaignTask } from './access';
import * as safe from './stored';
export async function sourceFiles(s: UnitOfWork, p: Principal, contextId: string, ids: string[], clock: Clock) {
    for (const id of ids) {
        const f = (await s.get('fileVersion', id)), task = f?.data.taskId ? (await s.get('task', f.data.taskId)) : null;
        if (!f || f.contextId !== contextId || !task || task.contextId !== contextId)
            unavailable();
        (await authorize(s, p, 'task.manage', taskScope(task), clock));
        (await canReferenceFile(s, p, f, taskScope(task), clock));
    }
}
export async function productTarget(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, x: CampaignProduct, clock: Clock) {
    if (!task.data.productIds.includes(x.productId))
        unavailable();
    const r = (await resolveProduct(s, p, task.contextId!, x.productId, clock)), pv = (await s.get('productVersion', x.productVersionId)), cv = (await s.get('contextProductVersion', x.contextProductVersionId));
    if (!pv || pv.data.productId !== x.productId || !cv || cv.data.contextProductId !== r.relation.id || cv.contextId !== task.contextId)
        unavailable();
    if (x.productUseId) {
        const u = (await s.get('productUseSnapshot', x.productUseId));
        if (!u || u.data.ownerType !== 'submission' || u.data.taskId !== task.id || u.data.productId !== x.productId || u.data.productVersionId !== pv.id || u.data.contextProductVersionId !== cv.id)
            unavailable();
        const sub = (await s.get('submission', u.data.ownerId));
        if (!sub || sub.data.taskId !== task.id || !sub.data.productUseIds.includes(u.id))
            unavailable();
        (await readProductUse(s, p, u.id, clock));
    }
}
export async function exactReference(s: UnitOfWork, p: Principal, input: SubmittedReference, clock: Clock) {
    const x = safe.submitted(input), task = (await campaignTask(s, p, x.taskId, clock)), row = (await s.get('submission', x.submissionId)), request = (await s.get('requestVersion', x.requestId));
    if (!row || row.contextId !== task.contextId || row.data.taskId !== task.id || row.data.requestId !== x.requestId || row.data.contentHash !== x.contentHash || !request || request.data.taskId !== task.id)
        unavailable();
    const snapshot = (await snapshotDTO(s, p, row, clock)), answer = x.answer ? snapshot.content.answers.find(a => a.requirementKey === x.answer!.requirementKey && a.productId === x.answer!.productId) : null;
    if (x.answer && !answer)
        unavailable();
    const answerIds = answer ? answerFiles([answer]) : row.data.fileVersionIds;
    for (const id of x.fileVersionIds) {
        const f = (await s.get('fileVersion', id));
        if (!f || f.data.visibility !== 'public' || !row.data.fileVersionIds.includes(id) || !answerIds.includes(id))
            unavailable();
        (await canReferenceFile(s, p, f, taskScope(task), clock));
    }
    for (const id of x.productUseIds) {
        const u = (await s.get('productUseSnapshot', id));
        if (!u || !row.data.productUseIds.includes(id) || u.data.ownerType !== 'submission' || u.data.ownerId !== row.id || u.data.taskId !== task.id || u.data.requestId !== request.id || x.answer?.productId && u.data.productId !== x.answer.productId)
            unavailable();
        (await readProductUse(s, p, id, clock));
    }
    return { row, request, snapshot, answer, reference: x };
}
export function menuTarget(menus: readonly PublicMenu[], identity: MenuIdentity) { const m = menus.find(m => menuIdentityKey(m.identity) === menuIdentityKey(identity) && m.identity.menuName === identity.menuName && m.identity.menuNumber === identity.menuNumber); if (!m)
    unavailable(); return m; }
function deadlines(menu: MenuDraft) { return [menu.request.deadline, ...menu.request.milestones.map(m => m.deadline), ...menu.conditions.schedules.map(m => m.deadline), ...menu.physical.flatMap(m => [m.plannedShip, m.plannedArrival]), ...menu.followups.map(m => m.deadline)]; }
export async function validateDraft(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, d: CampaignDraft, clock: Clock, publish = false, basis?: StoredRecord<'requestVersion'>) {
    const request = basis ?? (task.data.currentRequestId ? (await s.get('requestVersion', task.data.currentRequestId)) : null);
    if (publish && (!request || task.data.visibility !== 'public'))
        fail('REQUEST_REQUIRED', 409, '공개된 업무 요청에 메뉴 준비물 항목을 먼저 연결해 주세요.');
    for (const m of d.menus) {
        const catalog = (await s.get('campaignCatalogVersion', m.identity.catalogVersionId));
        if (!catalog || catalog.contextId !== task.contextId)
            unavailable();
        (await sourceFiles(s, p, task.contextId!, safe.sourceText(catalog.data.source).fileVersionIds, clock));
        (await asyncForEach(m.sourceStatements, async (a) => (await sourceFiles(s, p, task.contextId!, a.source.fileVersionIds, clock))));
        if (m.templateVersionId) {
            const template = (await s.get('templateVersion', m.templateVersionId));
            if (!template || template.contextId !== null && template.contextId !== task.contextId)
                unavailable();
        }
        (await asyncForEach(m.products, async (x) => (await productTarget(s, p, task, x, clock))));
        for (const deadline of deadlines(m)) {
            const u = (await s.get('user', deadline.responsibleUserId));
            if (!u || u.data.status !== 'active' || !(await activeMember(s, u.id, task.contextId!)) && !canAdmin(u, task.contextId!))
                fail('VALIDATION', 422, '일정 확인 책임자는 현재 컨텍스트의 활성 참여자를 선택해 주세요.');
        }
        for (const id of m.request.referenceFileIds) {
            const f = (await s.get('fileVersion', id));
            if (!f)
                unavailable();
            (await canReferenceFile(s, p, f, taskScope(task), clock));
            if (publish && (f.data.visibility !== 'public' || !request!.data.content.referenceFileIds.includes(id)))
                fail('VALIDATION', 422, '업무 공개 요청에 포함된 공개 참고 자료만 행사에 연결해 주세요.');
        }
        if (publish && m.request.requirements.some(q => !compatibleRequirement(q, m.request, request!.data.content)))
            fail('REQUEST_MISMATCH', 409, '메뉴 준비물과 업무 요청의 형식·상품·조건을 맞춘 뒤 공개해 주세요. 이전 제출은 보존됩니다.');
    }
}
