import { asyncFilter } from "@/domain/async-collections";
import { randomUUID } from 'node:crypto';
import type { Clock, RecordKind, UnitOfWork } from '@/domain/records';
import type { AuditDetail, AuditReference, AuditValue } from '@/domain/audit/types';
import type { Principal } from '@/server/auth/service';
/** Scope belongs to this UoW through awaited completion; finally restores nested command scope. */
const operations = new WeakMap<UnitOfWork, {
    operationId: string;
    receiptId: string;
}>();
export async function auditOperation<T>(s: UnitOfWork, receiptId: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = operations.get(s);
    operations.set(s, { operationId: receiptId, receiptId });
    try {
        return (await fn());
    }
    finally {
        if (previous)
            operations.set(s, previous);
        else
            operations.delete(s);
    }
}
const scalarKeys = new Set(['title', 'name', 'code', 'category', 'projectId', 'status', 'reason', 'revision', 'draftRevision', 'sequence', 'taskCount', 'count', 'assigneeId', 'ownerId', 'coAssigneeIds', 'authorId', 'decision', 'state', 'effect', 'mode', 'role', 'scope', 'internalPriceAccess', 'rows', 'visibility', 'readAt', 'draftTitle', 'draftDescription', 'draftBody', 'draftRequirementLabels', 'sourceName', 'sheetName', 'draftDeadline', 'draftDeadlineSource', 'draftNarrative', 'draftAnswerKeys']);
function value(x: unknown): AuditValue {
    if (x === undefined || x === null)
        return null;
    if (typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x))
        return x;
    if (Array.isArray(x) && x.every(v => typeof v === 'string'))
        return [...x];
    return null;
}
const referenceKeys: Record<string, RecordKind[]> = {
    requestVersionId: ['requestVersion'], requestId: ['requestVersion'], resultingRequestId: ['requestVersion'], submissionId: ['submission'], previousSubmissionId: ['submission'], draftId: ['submissionDraft'], templateVersionId: ['templateVersion'], completionId: ['completionSnapshot'], reopenId: ['completionReopen'], externalActionId: ['completionExternalAction'], batchId: ['importBatch', 'correctionBatch'], messageId: ['inquiryMessage'], questionId: ['inquiryQuestion'], transitionId: ['inquiryTransition'], linkId: ['inquiryTaskLink'], readId: ['inquiryRead', 'noticeRead'], activityId: ['taskActivity'], versionId: ['productVersion', 'contextProductVersion', 'retailPriceVersion', 'internalPriceVersion', 'evidenceVersion', 'noticeVersion', 'correctionOpinionVersion', 'campaignVersion', 'campaignCatalogVersion', 'scheduleVersion', 'aiVersion'], versionIds: ['productVersion', 'contextProductVersion', 'retailPriceVersion', 'internalPriceVersion'], factIds: ['correctionReflection', 'correctionResolution'], fileVersionIds: ['fileVersion'], productUseIds: ['productUseSnapshot'], campaignVersionId: ['campaignVersion'], selectionVersionId: ['campaignSelection'], factId: ['campaignSelection', 'campaignExternalFact', 'campaignPhysicalFact', 'campaignFollowupFact'], ids: ['evidenceVersion', 'evidenceLink', 'evidenceAssessment'], linkIds: ['evidenceLink'], contextVersionId: ['contextProductVersion'], commonVersionId: ['productVersion'], reviewId: ['correctionReview'], correctionBatchId: ['correctionBatch'], domainEventId: ['domainEvent'], domainEventIds: ['domainEvent'], followupId: ['completionFollowup'], snapshotId: ['aiSnapshot'], runId: ['aiRun', 'aiAnalysisRun'], resultId: ['aiAnalysisResult'],
};
const subjects: Record<string, RecordKind[]> = { task: ['task'], project: ['project'], template: ['templateVersion'], product: ['product'], submission: ['task'], evidence: ['evidence'], import: ['importBatch'], notice: ['notice'], inquiry: ['conversation'], correction: ['task', 'correctionBatch', 'correctionReview', 'correctionOpinion'], campaign: ['campaign', 'campaignCatalog'], schedule: ['schedule'], external: ['task'], completion: ['task'], ai: ['aiInput', 'aiRun', 'aiAnalysisRun', 'aiFindingReviewAction'], input: ['aiInput'], extraction: ['aiInput'], membership: ['membership'], invitation: ['invitation'], user: ['user'], context: ['context'] };
/** Only explicit stored IDs are resolved. No nearest-time or current-version inference. */
export async function explicitReferences(s: UnitOfWork, before: Record<string, unknown>, after: Record<string, unknown>): Promise<AuditReference[]> {
    const refs: AuditReference[] = [];
    for (const [role, facts] of [['before', before], ['after', after]] as const)
        for (const [key, kinds] of Object.entries(referenceKeys)) {
            const raw = facts[key], ids = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
            for (const id of ids) {
                const found = (await asyncFilter(kinds, async (k) => !!(await s.get(k, id))));
                if (found.length === 1)
                    refs.push({ kind: found[0], id, role });
            }
        }
    return refs;
}
export async function appendAudit(s: UnitOfWork, p: Pick<Principal, 'user'>, clock: Clock, contextId: string | null, action: string, targetId: string, before: Record<string, unknown>, after: Record<string, unknown>, extra: Partial<Pick<AuditDetail, 'subject' | 'references' | 'sensitivity'>> = {}) {
    const op = operations.get(s), candidates = subjects[action.split('.')[0]] ?? [], kinds = (await asyncFilter(candidates, async (k) => !!(await s.get(k, targetId))));
    const references = [...(await explicitReferences(s, before, after)), ...(extra.references ?? [])];
    const price = action === 'product.save_internal' || references.some(r => r.kind === 'internalPriceVersion') || typeof after.batchId === 'string' && (await s.get('importBatch', after.batchId))?.data.includesInternalPrice === true;
    const detail: AuditDetail = { schemaVersion: 2, operationId: op?.operationId ?? randomUUID(), receiptId: op?.receiptId ?? null, subject: extra.subject ?? (kinds.length === 1 ? { kind: kinds[0], id: targetId } : null), sensitivity: extra.sensitivity ?? (price ? 'internal_price' : 'standard'), references, changes: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => scalarKeys.has(k)).map(key => ({ key, before: value(before[key]), after: value(after[key]) })), sourcePrecision: references.length ? 'exact' : 'record_only' };
    return (await s.create('audit', { id: randomUUID(), contextId, data: { actorId: p.user.id, action, targetId, before, after, at: clock(), detail } }));
}
