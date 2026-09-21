import type { AiReviewRecords, AnalysisIssue } from '@/domain/ai-review/records';
import { array, hash, id, integer, object, oneOf, text } from '@/domain/ai-review/validate';
import { parseHumanReview } from '@/domain/ai-review/review';
import { fail } from '@/server/auth/errors';
export function corrupt(): never { return fail('STORAGE_UNAVAILABLE', 503, 'AI 검토 기록의 무결성을 확인할 수 없습니다.'); }
export function safely<T>(read: () => T): T { try { return read(); } catch { return corrupt(); } }
const nullableId = (v: unknown) => v === null ? null : id(v);
const time = (v: unknown) => { const t = text(v, 40); if (!Number.isFinite(Date.parse(t))) corrupt(); return t; };
const nullableTime = (v: unknown) => v === null ? null : time(v);
export function runData(value: unknown): AiReviewRecords['aiAnalysisRun'] {
  return safely(() => {
    const v = object(value); if (typeof v.providerCalled !== 'boolean') corrupt();
    return { inputId: id(v.inputId), inputVersionId: id(v.inputVersionId), extractionRunId: id(v.extractionRunId), extractionSnapshotId: id(v.extractionSnapshotId), snapshotHash: hash(v.snapshotHash), corpusReleaseId: id(v.corpusReleaseId), corpusManifestHash: hash(v.corpusManifestHash), engine: oneOf(v.engine, ['synthetic_demo', 'provider']), modelId: text(v.modelId, 160), promptVersion: text(v.promptVersion, 160), taskId: nullableId(v.taskId), providerCalled: v.providerCalled, createdBy: id(v.createdBy), attempt: integer(v.attempt, 1), previousRunId: nullableId(v.previousRunId), state: oneOf(v.state, ['queued', 'running', 'finished', 'failed']), claimId: nullableId(v.claimId), leaseUntil: nullableTime(v.leaseUntil), startedAt: nullableTime(v.startedAt), endedAt: nullableTime(v.endedAt), resultId: nullableId(v.resultId), issue: v.issue === null ? null : oneOf<AnalysisIssue>(v.issue, ['ENGINE_ERROR', 'RESULT_INVALID', 'ACCESS_CHANGED', 'SOURCE_CHANGED', 'CORPUS_CHANGED', 'INTERRUPTED', 'STORAGE_UNAVAILABLE']) };
  });
}
export function actionData(value: unknown): AiReviewRecords['aiFindingReviewAction'] {
  return safely(() => {
    const v = object(value), parsed = parseHumanReview({ ...v, expectedRevision: 0 });
    return { findingId: parsed.findingId, decision: parsed.decision, reason: parsed.reason, editedSuggestion: parsed.editedSuggestion, runId: id(v.runId), resultId: id(v.resultId), reviewId: id(v.reviewId), previousActionId: nullableId(v.previousActionId), sequence: integer(v.sequence, 1), reviewedBy: id(v.reviewedBy), reviewedAt: time(v.reviewedAt) };
  });
}
export const safeIds = (v: unknown) => safely(() => array(v, 100).map(id));
