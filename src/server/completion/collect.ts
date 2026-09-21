import { createHash } from 'node:crypto';
import type { Clock, RecordKind, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Available, CompletionBasis } from '@/domain/completion/types';
import type { Principal } from '@/server/auth/service';
import { AuthError, unavailable } from '@/server/auth/errors';
import { safeEvaluation } from '@/server/submissions/projection';
import { readInquirySummary } from '@/server/inquiries/read';
import { questionDTO, questions } from '@/server/inquiries/projection';
import { readCorrectionRemainder } from '@/server/corrections/summary';
import { batchContent } from '@/server/corrections/projection';
import { readProductUse } from '@/server/products/capture';
import { resolveProduct } from '@/server/products/access';
import * as safe from './stored';
export const latestSubmission = (s: UnitOfWork, t: StoredRecord<'task'>) => s.list('submission', t.contextId!).filter(x => x.data.taskId === t.id).sort((a, b) => safe.count(b.data.sequence, 1) - safe.count(a.data.sequence, 1))[0] ?? null;
export function available<T>(read: () => T): Available<T> { try {
    return { connected: true, state: 'available', value: read() };
}
catch (e) {
    if (e instanceof AuthError && [403, 404, 409, 503].includes(e.status))
        return { connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' };
    throw e;
} }
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** The authority and all producers are read in the caller's single synchronous transaction. */
export function collectBasis(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, clock: Clock) {
    const current = task.data.currentRequestId ? s.get('requestVersion', task.data.currentRequestId) : null, latest = latestSubmission(s, task), original = latest ? s.get('requestVersion', latest.data.requestId) : null;
    const sourceRows: StoredRecord[] = [task];
    const context = task.contextId!;
    const kinds: RecordKind[] = ['requestVersion', 'submission', 'submissionDraft', 'productUseSnapshot', 'completionExternalAction', 'correctionOpinion', 'correctionOpinionVersion', 'correctionDraft', 'correctionBatch', 'correctionItemState', 'correctionReflection', 'correctionResolution', 'correctionReview'];
    for (const kind of kinds)
        sourceRows.push(...s.list(kind, context).filter(r => { const d = r.data as unknown as {
            taskId?: unknown;
            target?: {
                taskId?: unknown;
            };
        }; return d.taskId === task.id || d.target?.taskId === task.id; }));
    const conversations = s.list('conversation', context).filter(c => c.data.taskId === task.id && c.data.phase === 'active');
    sourceRows.push(...conversations);
    for (const kind of ['inquiryQuestion', 'inquiryTransition', 'inquiryMessage', 'inquiryTaskLink'] as const)
        sourceRows.push(...s.list(kind, context).filter(r => conversations.some(c => c.id === r.data.conversationId)));
    const currentProducts = available(() => task.data.productIds.map(productId => { const r = resolveProduct(s, p, context, productId, clock); sourceRows.push(r.product, r.relation, r.common, r.local); return { productId: safe.id(productId), productVersionId: r.common.id, contextProductVersionId: r.local.id, commonRevision: r.product.revision, contextRevision: r.relation.revision }; }));
    const currentEvaluation = available(() => { if (!current || current.data.taskId !== task.id)
        unavailable(); return safe.evaluation(safeEvaluation(current.data.content, latest?.data.answers ?? [], original?.data.content ?? null, true)); });
    const originalSubmittedEvaluation = available(() => { if (!original || !latest)
        unavailable(); return safe.evaluation(safeEvaluation(original.data.content, latest.data.answers)); });
    const inquiries = available(() => { const visible = readInquirySummary(s, p, context, clock, task.id), items = visible.items.flatMap(c => { const row = s.get('conversation', c.id)!; return questions(s, row).map(q => { const dto = questionDTO(s, p, q, row), message = s.get('inquiryMessage', dto.openingMessageId); return safe.inquiry({ conversationId: row.id, questionId: q.id, revision: q.revision, text: message ? safe.text(message.data.body, 20000) : '질문 원문 확인 필요', state: dto.state, externalWait: dto.externalWait }); }); }); return { items, unresolved: items.filter(q => q.state !== 'resolved').length, externalWaiting: items.filter(q => q.state === 'external_waiting').length }; });
    const corrections = available(() => { const value = readCorrectionRemainder(s, p, task.id, clock); const pendingScopes = s.list('correctionBatch', context).filter(b => b.data.taskId === task.id).flatMap(b => batchContent(b).pendingScopes.map(x => ({ batchVersionId: b.id, agency: x.agency, scope: x.scope, expectedOn: x.expectedOn }))); return { items: value.items.map(safe.correction), unresolved: safe.count(value.unresolved), pendingScopes }; });
    const externalActions = s.list('completionExternalAction', context).filter(r => r.data.taskId === task.id).map(r => { const a = safe.external(r.data); return { id: r.id, visibility: a.visibility, purpose: a.purpose, latestProgress: a.latestProgress, waitingExternal: a.waitingExternal, observedAt: a.observedAt, recordedAt: safe.time(r.data.recordedAt) }; });
    const products = available(() => latest ? latest.data.productUseIds.map(id => safe.productUse(readProductUse(s, p, id, clock))) : []);
    const value: CompletionBasis = { currentRequest: current ? { id: safe.id(current.id), sequence: safe.count(current.data.sequence, 1) } : null, currentRequestUnavailable: !!task.data.currentRequestId && !current, latestSubmission: latest ? { id: safe.id(latest.id), requestId: safe.id(latest.data.requestId), sequence: safe.count(latest.data.sequence, 1), mode: safe.choice(latest.data.mode, ['partial', 'full']), contentHash: safe.hash(latest.data.contentHash), submittedAt: safe.time(latest.data.submittedAt), fileVersionIds: latest.data.fileVersionIds.map(safe.id), products } : null, latestMatchesCurrentRequest: latest && current ? latest.data.requestId === current.id : null, currentEvaluation, originalSubmittedEvaluation, currentProducts, inquiries, corrections, externalActions, campaign: { connected: false, state: 'not_connected', value: null }, ai: { connected: false, state: 'not_connected', value: null } };
    // File/current relationship changes also invalidate a stale preview, even without task revision changes.
    const fileIds = new Set([...(current?.data.content.referenceFileIds ?? []), ...(latest?.data.fileVersionIds ?? []), ...s.list('completionExternalAction', context).filter(r => r.data.taskId === task.id).flatMap(r => [...r.data.source.fileVersionIds, ...r.data.evidenceFileVersionIds])]);
    sourceRows.push(...s.list('fileVersion', context).filter(r => fileIds.has(r.id)));
    const ordered = [...new Map(sourceRows.map(r => [`${r.kind}:${r.id}`, r])).values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    return { basis: safe.basis(value), basisHash: digest({ taskRevision: task.revision, rows: ordered.map(r => ({ kind: r.kind, id: r.id, revision: r.revision, data: r.data })), basis: value }) };
}
