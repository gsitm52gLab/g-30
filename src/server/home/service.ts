import { asyncFilter } from '@/domain/async-collections';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import { calendarPosition } from '@/domain/scheduling/calendar';
import { reminderEligibility } from '@/domain/notifications/eligibility';
import { hasScope, needScope, type IdentityService, type Principal } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { searchTransaction } from '@/server/search/transaction';
import { userLabel } from '@/server/submissions/access';
import { latestSubmission } from '@/server/submissions/read';
import { safeEvaluation } from '@/server/submissions/projection';
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { readCorrectionRemainder, readSubmissionReview } from '@/server/corrections/summary';
import { readCompletionSummary } from '@/server/completion/summary';
import { readInquirySummary } from '@/server/inquiries/read';
import { questions } from '@/server/inquiries/projection';
import { scheduleSources } from '@/server/scheduling/read';
import { sourceDeadline, taskActionUrl } from '@/server/scheduling/projection';
import type { SourceSchedule } from '@/server/scheduling/types';
import { noticeScope } from '@/server/notices/access';
import { resolveProduct } from '@/server/products/access';
import { resolveCampaign, manager } from '@/server/campaigns/access';
import { versionDTO as campaignVersion } from '@/server/campaigns/projection';
import { draft as campaignDraft } from '@/server/campaigns/stored';
import type { HomeDTO, HomeQuery, HomeTask, HomePerson, HomeDate } from './contracts';

export function homeQuery(params: URLSearchParams): HomeQuery {
  if ([...params.keys()].some(k => !['scope', 'context', 'view'].includes(k) || params.getAll(k).length !== 1)) fail('VALIDATION', 422, '홈 조회 범위를 확인해 주세요.');
  const scope = params.get('scope') || undefined, context = params.get('context') || undefined;
  if (scope && !['mine', 'context', 'all'].includes(scope) || context && !/^[A-Za-z0-9_-]{1,160}$/.test(context)) fail('VALIDATION', 422, '홈 조회 범위를 확인해 주세요.');
  return { scope: scope as HomeQuery['scope'], context };
}
const active = (t: StoredRecord<'task'>) => !['draft', 'completed', 'cancelled', 'on_hold'].includes(t.data.status);
const ownTask = (t: StoredRecord<'task'>, p: Principal) => p.user.data.role === 'gsg' ? t.data.ownerId === p.user.id : [t.data.assigneeId, ...(t.data.coAssigneeIds ?? [])].includes(p.user.id);
const contextLabel = (c: StoredRecord<'context'>) => [c.data.country, c.data.retailer, c.data.brand].join(' · ');
const person = async (s: UnitOfWork, p: Principal, context: string, id: string): Promise<HomePerson> => ({ id, label: await userLabel(s, p, context, id) });

/** Uses the notification domain's current-need predicate; this is a read, never delivery.
 * A GSG overview evaluates the actual source's active owners, not the logged-in viewer as recipient.
 */
export function dateBucket(row: SourceSchedule, now: string): Pick<HomeDate, 'pending' | 'bucket'> {
  const need = row.need, calendar = calendarPosition(row.deadline, now);
  if (!need || row.reminderSupport !== 'current_need') return { pending: false, bucket: 'later' };
  const role = need.kind === 'brand_submission' ? 'brand' : need.kind === 'responsible_action' ? need.recipientRole : 'gsg';
  const decision = reminderEligibility({ timing: { deadline: row.deadline, active: row.active, unresolvedConflict: row.unresolvedConflict }, need, recipient: row.actionOwnerIds[0] ? { id: row.actionOwnerIds[0], role, active: true, sourceReadable: true } : null }, now);
  const relevant = decision.eligible || ['not_due', 'undated', 'needs_confirmation', 'unresolved_conflict', 'needs_assignment'].includes(decision.reason);
  if (!relevant) return { pending: false, bucket: 'later' };
  if (!decision.eligible && ['undated', 'needs_confirmation', 'unresolved_conflict', 'needs_assignment'].includes(decision.reason)) return { pending: true, bucket: 'confirmation' };
  return { pending: true, bucket: calendar.daysUntil! < 0 ? 'overdue' : calendar.daysUntil === 0 ? 'today' : calendar.daysUntil! <= 2 ? 'near' : 'later' };
}

async function taskDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'task'>, context: StoredRecord<'context'>, clock: Clock): Promise<HomeTask> {
  const d = row.data, ctx = context.id, request = d.currentRequestId ? await s.get('requestVersion', d.currentRequestId) : null;
  if (d.currentRequestId && (!request || request.data.taskId !== row.id || request.contextId !== ctx)) unavailable();
  const latest = await latestSubmission(s, row), previous = latest ? await s.get('requestVersion', latest.data.requestId) : null;
  if (latest && (!previous || previous.contextId !== ctx || previous.data.taskId !== row.id)) unavailable();
  const evaluated = request ? safeEvaluation(request.data.content, latest?.data.answers ?? [], previous?.data.content ?? request.data.content, !!latest, (await campaignRequestSource(s, request))?.noMaterials === true) : null;
  const corrections = await readCorrectionRemainder(s, p, row.id, clock), completion = await readCompletionSummary(s, p, row.id, clock);
  const review = p.user.data.role === 'gsg' && latest ? await readSubmissionReview(s, p, row.id, latest.id, clock) : null;
  const external = p.user.data.role === 'gsg' && latest ? (await s.list('completionExternalAction', ctx)).filter(x => x.data.taskId === row.id && x.data.source.submissionId === latest.id) : [];
  const products: HomeTask['products'] = [];
  for (const id of d.productIds) {
    const relation = (await s.list('contextProduct', ctx)).find(r => r.data.productId === id);
    if (!relation) continue;
    const product = await resolveProduct(s, p, ctx, id, clock);
    products.push({ id, name: product.common.data.common.name, url: `/products/${encodeURIComponent(id)}?context=${encodeURIComponent(ctx)}` });
  }
  const project = d.projectId ? await s.get('project', d.projectId) : null;
  if (project && project.contextId !== ctx) unavailable();
  return {
    id: row.id, contextId: ctx, contextLabel: contextLabel(context), title: d.title, category: d.category, status: d.status,
    url: taskActionUrl(row.id, ctx), nextAction: d.nextAction, own: ownTask(row, p), owner: await person(s, p, ctx, d.ownerId),
    assignees: await Promise.all([...new Set([d.assigneeId, ...(d.coAssigneeIds ?? [])])].map(id => person(s, p, ctx, id))), products,
    project: project ? { id: project.id, title: project.data.title, url: `/projects/${encodeURIComponent(project.id)}?context=${encodeURIComponent(ctx)}` } : null,
    // Legacy previews retain unknown precision, timezone and certainty rather than inventing a deadline.
    deadline: request ? sourceDeadline(request.data.content.deadline) : d.schemaVersion === 2 && d.draft ? sourceDeadline(d.draft.deadline) : null,
    requirements: request ? request.data.content.requirements.map(q => ({ key: q.key, label: q.label, type: q.type, required: q.required })) : [],
    remaining: evaluated?.missing ?? null, corrections: corrections.unresolved,
    submission: latest ? { id: latest.id, mode: latest.data.mode, current: latest.data.requestId === request?.id, at: latest.data.submittedAt } : null,
    reviewPending: !!(active(row) && latest && review?.status === 'pending'),
    // No field claims that external handoff is mandatory or approved. This flags an exact-version gap to check.
    handoffCheck: !!(active(row) && latest?.data.mode === 'full' && latest.data.requestId === request?.id && review && review.reviews.length > 0 && review.reviews.every(r => r.result === 'no_changes_requested') && !corrections.unresolved && !external.length),
    completedAt: completion.status === 'completed' ? completion.latestCompletedAt : null,
  };
}

export class HomeService {
  constructor(public identity: IdentityService) {}
  async navigation(token?: string) { return searchTransaction(this.identity.repo, async s => { const p = await this.identity.principal(s, token); return { role: p.user.data.role }; }); }
  async read(token: string | undefined, query: HomeQuery): Promise<HomeDTO> {
    return searchTransaction(this.identity.repo, async s => {
      const p = await this.identity.principal(s, token), clock = this.identity.clock, scope = query.scope ?? (p.user.data.role === 'gsg' ? 'all' : 'mine');
      // Even unused explicit context IDs are authorized before returning counts or titles.
      if (query.context) await needScope(s, p, query.context, clock);
      const contexts = await asyncFilter(await s.list('context'), c => hasScope(s, p, c.id, clock));
      const selected = query.context ?? contexts[0]?.id ?? null;
      const included = scope === 'context' ? contexts.filter(c => c.id === selected) : contexts;
      const result: HomeDTO = { role: p.user.data.role, actor: { id: p.user.id, label: p.user.data.name }, mode: this.identity.repo.mode, scope, selectedContext: selected, contexts: contexts.map(c => ({ id: c.id, label: contextLabel(c) })), tasks: [], questions: [], dates: [], notices: [], campaigns: [], counts: { tasks: 0, unresolved: 0, overdue: 0, today: 0, near: 0, externalChecks: 0, newSubmissions: 0, handoffChecks: 0, corrections: 0, confirmation: 0, unreadNotices: 0 }, generatedAt: clock(), sideEffects: 'none' };
      for (const context of included) {
        const ctx = context.id;
        const visibleTasks = await asyncFilter(await s.list('task', ctx), async t => (await decide(s, p, 'task.read', taskScope(t), clock)).allowed);
        const selectedTasks = visibleTasks.filter(t => scope !== 'mine' || ownTask(t, p));
        for (const t of selectedTasks) result.tasks.push(await taskDTO(s, p, t, context, clock));
        const summaries = await readInquirySummary(s, p, ctx, clock);
        for (const item of summaries.items) {
          const conversation = await s.get('conversation', item.id);
          if (!conversation) unavailable();
          const task = item.task ? visibleTasks.find(t => t.id === item.task!.id) : null;
          const items = await questions(s, conversation);
          for (const [i, q] of items.entries()) {
            if (q.data.state === 'resolved') continue;
            const ownerId = q.data.externalWait?.responsibleUserId ?? task?.data.ownerId;
            const own = p.user.data.role === 'brand' ? conversation.data.initiatorId === p.user.id : ownerId === p.user.id;
            if (scope === 'mine' && !own) continue;
            result.questions.push({ id: q.id, conversationId: item.id, contextId: ctx, title: item.title, number: i + 1, state: q.data.state, url: `/inquiries/${encodeURIComponent(item.id)}?context=${encodeURIComponent(ctx)}#question-${encodeURIComponent(q.id)}`, owner: ownerId ? await person(s, p, ctx, ownerId) : null, taskId: item.task?.id ?? null });
          }
        }
        for (const source of await scheduleSources(s, p, ctx, clock)) {
          const ownedTask = source.taskId && selectedTasks.some(t => t.id === source.taskId);
          if (scope === 'mine' && !ownedTask && !source.actionOwnerIds.includes(p.user.id)) continue;
          const bucket = dateBucket(source, clock());
          const url = source.source.kind === 'inquiry_external' ? `${source.actionUrl}#question-${encodeURIComponent(source.source.itemKey)}` : source.actionUrl;
          result.dates.push({ key: source.logicalKey, contextId: ctx, taskId: source.taskId, title: source.title, kind: source.kind, url, deadline: source.deadline, owners: await Promise.all(source.actionOwnerIds.map(id => person(s, p, ctx, id))), ...bucket, external: source.kind === 'external_check' });
        }
        for (const n of await s.list('notice', ctx)) {
          if (!(await decide(s, p, 'notice.read', await noticeScope(s, n), clock)).allowed || !n.data.currentVersionId) continue;
          const v = await s.get('noticeVersion', n.data.currentVersionId); if (!v) unavailable();
          result.notices.push({ id: n.id, contextId: ctx, title: v.data.content.title, url: `/notices/${encodeURIComponent(n.id)}?context=${encodeURIComponent(ctx)}`, unread: !(await s.list('noticeRead', ctx)).some(r => r.data.versionId === v.id && r.data.userId === p.user.id) });
        }
        for (const c of await s.list('campaign', ctx)) {
          if (!selectedTasks.some(t => t.id === c.data.taskId)) continue;
          // Draft existence and titles are projected only through current campaign authorization.
          const canManage = await manager(s, p, c.data.taskId, clock);
          if (!canManage && !c.data.currentVersionId) continue;
          const { task } = await resolveCampaign(s, p, c.id, clock);
          const v = c.data.currentVersionId ? await s.get('campaignVersion', c.data.currentVersionId) : null;
          if (c.data.currentVersionId && !v) unavailable();
          const published = v ? await campaignVersion(s, p, v, clock) : null;
          result.campaigns.push({ id: c.id, taskId: task.id, title: canManage ? campaignDraft(c.data.draft).title : published!.title, taskTitle: task.data.title, contextId: ctx, url: `/tasks/${encodeURIComponent(task.id)}/campaigns?context=${encodeURIComponent(ctx)}&campaign=${encodeURIComponent(c.id)}` });
        }
      }
      result.tasks.sort((a, b) => (a.deadline?.value ?? 'z').localeCompare(b.deadline?.value ?? 'z') || a.id.localeCompare(b.id));
      result.dates.sort((a, b) => (a.deadline.value ?? 'z').localeCompare(b.deadline.value ?? 'z') || a.key.localeCompare(b.key));
      const pendingDates = result.dates.filter(d => d.pending);
      result.counts = { tasks: result.tasks.length, unresolved: result.questions.length, overdue: pendingDates.filter(d => !d.external && d.bucket === 'overdue').length, today: pendingDates.filter(d => !d.external && d.bucket === 'today').length, near: pendingDates.filter(d => !d.external && d.bucket === 'near').length, externalChecks: pendingDates.filter(d => d.external).length, newSubmissions: result.tasks.filter(t => t.reviewPending).length, handoffChecks: result.tasks.filter(t => t.handoffCheck).length, corrections: result.tasks.reduce((sum, t) => sum + t.corrections, 0), confirmation: pendingDates.filter(d => d.bucket === 'confirmation').length, unreadNotices: result.notices.filter(n => n.unread).length };
      return result;
    });
  }
}
