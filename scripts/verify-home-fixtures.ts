import { randomUUID } from 'node:crypto';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import { localCalendarDay } from '@/domain/scheduling/calendar';
import type { IdentityService } from '@/server/auth/service';
import { TaskService } from '@/server/tasks/service';
import { ProductService } from '@/server/products/service';
import { SubmissionService } from '@/server/submissions/service';
import { InquiryService } from '@/server/inquiries/service';
import { CorrectionService } from '@/server/corrections/service';
import { CompletionService } from '@/server/completion/service';
import { SchedulingService } from '@/server/scheduling/service';
import { NoticeService } from '@/server/notices/service';
import { blankNotice } from '@/domain/notices/types';
export const A = 'ctx-jp-a-luna', B = 'ctx-jp-b-luna';
export interface HomeActors { admin: string; brand: string; gsg: string; team: string; co: string }
export async function createHomeFixtures(identity: IdentityService, actor: HomeActors, prefix: string) {
  const tasks = new TaskService(identity), inquiries = new InquiryService(identity), sub = new SubmissionService(identity), notices = new NoticeService(identity);
  if (!(await identity.repo.list('membership', B)).some(m => m.data.userId === 'user-admin' && m.data.status === 'active')) await identity.repo.transaction(s => s.create('membership', { id: randomUUID(), contextId: B, data: { userId: 'user-admin', role: 'operator', status: 'active', scope: 'G03 isolated synthetic fixture', internalPriceAccess: false, activatedAt: identity.clock(), suspendedAt: null } }));
  const today = localCalendarDay(identity.clock(), 'Asia/Tokyo');
  const day = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  async function task(label: string, delta: number | null, category: 'spot' | 'onboarding' = 'spot', contextId = A, co = true) {
    const content = blankContent(); content.title = `${prefix} ${label}`; content.description = '합성 요청 본문'; content.nextAction = '요청을 읽고 답변 제출';
    content.deadline = { ...content.deadline, responsibleUserId: contextId === A ? 'user-gsg' : 'user-admin', value: delta === null ? null : day(delta), certainty: 'confirmed', timezone: 'Asia/Tokyo' };
    content.requirements = [{ ...blankRequirement('answer'), label: '일본어 상품 설명' }, { ...blankRequirement('next', 'short_text'), label: '추가 확인' }];
    const target = { contextId, ownerId: contextId === A ? 'user-gsg' : 'user-admin', assigneeId: 'user-luna', coAssigneeIds: co && contextId === A ? ['user-co'] : [], productIds: contextId === A ? ['product-serum'] : ['product-cream'] };
    const projectId = category === 'onboarding' ? (await tasks.createProject(actor.admin, { title: `${prefix} 입점 프로젝트`, target, templateVersionIds: [(await tasks.catalog(actor.admin, contextId)).templates[0].id], idempotencyKey: randomUUID() })).ids[0] : null;
    const id = (await tasks.create(actor.admin, { content, category, projectId, targets: [target], idempotencyKey: randomUUID() })).ids[0];
    await tasks.command(actor.admin, id, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }); return id;
  }
  const todayTask = await task('오늘 신규 입점', 0, 'onboarding'), near = await task('내일', 1), overdue = await task('초과', -1), unknown = await task('기한 미정', null), foreign = await task('다른 리테일러 비공개표식', 0, 'spot', B);
  const held = await task('보류', -1), cancelled = await task('취소', -1), full = await task('전체 제출', -1);
  for (const [id, command] of [[held, 'hold'], [cancelled, 'cancel']]) await tasks.command(actor.admin, id, { command, reason: '합성 상태 검증', expectedRevision: (await identity.repo.get('task', id))!.revision, idempotencyKey: randomUUID() });
  async function submit(taskId: string, mode: 'partial' | 'full') {
    let w = await sub.workspace(actor.brand, taskId);
    const product = await new ProductService(identity).detail(actor.brand, 'product-serum', A);
    const productSelections = [{ productId: product.productId, expectedCommonRevision: product.commonRevision, expectedContextRevision: product.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: today }];
    await sub.draft(actor.brand, taskId, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft?.revision ?? 0, content: { ...blankDraft(), productSelections, narrative: '합성 제출', answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: '합성 일본어 설명' } }, ...(mode === 'full' ? [{ requestId: w.request.id, requirementKey: 'next', productId: null, type: 'short_text' as const, input: { text: '확인됨' } }] : [])] }, idempotencyKey: randomUUID() });
    w = await sub.workspace(actor.brand, taskId);
    return (await sub.submit(actor.brand, taskId, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode, idempotencyKey: randomUUID() })).ids[0];
  }
  const completed = await task('잔여 자료가 있어도 수동 완료', -1);
  const completion = new CompletionService(identity), basis = await completion.workspace(actor.admin, completed);
  await completion.command(actor.admin, { command: 'complete', taskId: completed, expectedTaskRevision: basis.taskRevision, expectedBasisHash: basis.preview!.basisHash, memo: '합성 잔여 상태 고정', idempotencyKey: randomUUID() });
  const conflict = (await new SchedulingService(identity).command(actor.admin, { command: 'save', contextId: A, scheduleId: null, expectedRevision: 0, reason: '기한 원문 충돌', content: { taskId: near, title: `${prefix} 상충하는 인쇄 일정`, kind: 'printing', visibility: 'public', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg', value: day(-1), certainty: 'confirmed' }, statements: [{ id: 'a', raw: '월요일', source: '합성 A', version: '1', locator: '1' }, { id: 'b', raw: '화요일', source: '합성 B', version: '1', locator: '1' }], conflicts: [{ id: 'c', statementIds: ['a', 'b'], state: 'unresolved', resolution: '' }] }, idempotencyKey: randomUUID() })).ids[0];
  const partialSubmission = await submit(todayTask, 'partial'), fullSubmission = await submit(full, 'full');
  const newSubmissionTask = await task('검토 대기 새 제출', 30); await submit(newSubmissionTask, 'partial');
  const correction = new CorrectionService(identity);
  const target = async (submissionId: string) => { const row = (await identity.repo.get('submission', submissionId))!; return { taskId: row.data.taskId, submissionId, requestId: row.data.requestId, submissionContentHash: row.data.contentHash, answer: null, fileVersionIds: [], productUseIds: row.data.productUseIds, location: { page: '1', locator: '합성 전체 제출' } }; };
  await correction.command(actor.admin, { command: 'record_review', taskId: full, target: await target(fullSubmission), source: { kind: 'external_opinion', agency: '합성 기관', reviewer: '가상 검토자', source: '허용 공개 합성 판단' }, scope: { medium: 'POP', language: 'ja', usePlace: '합성 리테일러', productIds: ['product-serum'] }, receivedOn: today, result: 'no_changes_requested', rationale: '합성 검토 사실', evidenceFileVersionIds: [], previousReviewId: null, idempotencyKey: randomUUID() });
  const opinionId = (await correction.command(actor.admin, { command: 'save_opinion', taskId: todayTask, opinionId: null, expectedRevision: 0, opinion: { target: await target(partialSubmission), source: { kind: 'external_opinion', agency: '합성 기관', reviewer: '가상 검토자', source: '합성 원문' }, originalText: 'G03_PRIVATE_OPINION', internalFileVersionIds: [], receivedOn: today, conflictingOpinionVersionIds: [] }, idempotencyKey: randomUUID() })).ids[1];
  const correctionDraft = (await correction.command(actor.admin, { command: 'save_draft', taskId: todayTask, draftId: null, expectedRevision: 0, draft: { title: `${prefix} 보완`, summary: '공개 보완', items: [{ key: 'change', target: await target(partialSubmission), internalOpinionVersionIds: [opinionId], publicSource: '공개 합성 지침', change: '표현 수정', reason: '합성 규격', publicDescription: '일본어 설명을 보완해 주세요', priority: 'normal', issue: 'correction' }], mode: 'normal', pendingScopes: [], previousBatchVersionId: null }, idempotencyKey: randomUUID() })).ids[0];
  await correction.command(actor.admin, { command: 'publish', taskId: todayTask, draftId: correctionDraft, expectedRevision: 1, idempotencyKey: randomUUID() });
  const conversation = await inquiries.createDraft(actor.brand, { contextId: A, taskId: todayTask, idempotencyKey: randomUUID() });
  const content = (body: string) => ({ clientMessageId: randomUUID(), body, fileVersionIds: [] });
  await inquiries.command(actor.brand, conversation.conversationId, { command: 'publish_first', expectedRevision: conversation.revision, title: `${prefix} 다섯 질문`, content: content('질문 1'), idempotencyKey: randomUUID() });
  for (let i = 2; i <= 5; i++) { const d = await inquiries.detail(actor.brand, conversation.conversationId); await inquiries.command(actor.brand, conversation.conversationId, { command: 'question', expectedRevision: d.revision, content: content(`질문 ${i}`), idempotencyKey: randomUUID() }); }
  const detail = await inquiries.detail(actor.gsg, conversation.conversationId); if (detail.phase !== 'active') throw Error('fixture question phase');
  for (const q of detail.questions.slice(0, 4)) await inquiries.command(actor.gsg, detail.id, { command: 'answer', questionId: q.id, expectedQuestionRevision: q.revision, content: content('실제 합성 답변'), idempotencyKey: randomUUID() });
  const q = detail.questions[4];
  await inquiries.command(actor.gsg, detail.id, { command: 'state', questionId: q.id, expectedQuestionRevision: q.revision, state: 'external_waiting', reason: '실제 외부 회신 대기', externalWait: { counterparty: '합성 리테일러', sentAt: identity.clock(), responsibleUserId: 'user-gsg', nextCheckDate: day(-1), timezone: 'Asia/Tokyo', latestResult: '미확인' }, idempotencyKey: randomUUID() });
  const notice = (await notices.create(actor.admin, { contextId: A, content: { ...blankNotice(), title: `${prefix} 공지`, body: '현재 공개 공지', documentVersion: 'v1' }, idempotencyKey: randomUUID() })).ids[0];
  await notices.command(actor.admin, notice, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
  return { prefix, today, todayTask, near, overdue, unknown, foreign, held, cancelled, completed, conflict, full, newSubmissionTask, partialSubmission, fullSubmission, conversationId: detail.id, questionId: q.id, notice };
}
