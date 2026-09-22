import { fail } from '@/server/auth/errors';
import { object, ids, list, str, enumValue, dateValue } from '../tasks/validate';
import { rawText } from '../submissions/validate';
import type { ReviewTarget, OpinionSource, OpinionInput, BatchDraftInput, CorrectionItemDraft, SaveOpinionCommand, SaveBatchDraftCommand, PublishBatchCommand, ReflectItemsCommand, ResolveItemsCommand, RecordReviewCommand } from './types';

export const correctionLimits = { items: 80, references: 80, pendingScopes: 40, title: 200, publicText: 5000, originalText: 20000, locator: 2000 } as const;
const id = (value: unknown) => ids([value])[0];
const nullableId = (value: unknown) => value === null ? null : id(value);
const nullableDate = (value: unknown) => value === null ? null : dateValue(value);
function revision(value: unknown, allowZero = true): number {
    if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) fail('VALIDATION', 422, '정확한 기준 버전을 확인해 주세요.');
    return Number(value);
}
function nonempty<T>(values: T[]): T[] {
    if (!values.length) fail('VALIDATION', 422, '적용할 항목을 명시적으로 선택해 주세요.');
    return values;
}
function distinctKeys<T extends { key: string }>(values: T[]) {
    if (new Set(values.map(v => v.key)).size !== values.length) fail('VALIDATION', 422, '항목 키가 중복됩니다.');
    return values;
}
function sameTask(target: ReviewTarget, taskId: string) {
    if (target.taskId !== taskId) fail('VALIDATION', 422, '한 업무의 정확한 제출 버전을 선택해 주세요.');
}
function commandIdentity(v: Record<string, unknown>) { return { taskId: id(v.taskId), idempotencyKey: str(v.idempotencyKey, 160, true) }; }
function creatingOrEditing(recordId: string | null, expected: unknown) {
    const parsed = revision(expected);
    if (recordId === null ? parsed !== 0 : parsed === 0) fail('VALIDATION', 422, '신규 또는 기존 초안의 기준 버전을 확인해 주세요.');
    return parsed;
}
/** Validates shape only; this does not establish stored ownership, publication or current authority. */
export function parseReviewTarget(value: unknown): ReviewTarget {
    const v = object(value, ['taskId', 'submissionId', 'requestId', 'submissionContentHash', 'answer', 'fileVersionIds', 'productUseIds', 'location']);
    const hash = str(v.submissionContentHash, 64, true);
    if (!/^[a-f0-9]{64}$/.test(hash)) fail('VALIDATION', 422, '정확한 제출 해시를 확인해 주세요.');
    const location = object(v.location, ['page', 'locator']);
    let answer: ReviewTarget['answer'] = null;
    if (v.answer !== null) {
        const a = object(v.answer, ['requirementKey', 'productId']);
        answer = { requirementKey: id(a.requirementKey), productId: nullableId(a.productId) };
    }
    return { taskId: id(v.taskId), submissionId: id(v.submissionId), requestId: id(v.requestId), submissionContentHash: hash, answer,
        fileVersionIds: ids(v.fileVersionIds, correctionLimits.references), productUseIds: ids(v.productUseIds, correctionLimits.references),
        location: { page: location.page === null ? null : str(location.page, 100, true), locator: rawText(location.locator, correctionLimits.locator) } };
}
export function parseOpinionSource(value: unknown): OpinionSource {
    const v = object(value, ['kind', 'reviewer', 'agency', 'source', 'runId', 'findingId']);
    const kind = enumValue(v.kind, ['internal_review', 'external_opinion', 'ai_candidate']);
    const source = str(v.source, 2000, true);
    if (kind === 'ai_candidate') { object(v, ['kind', 'source', 'runId', 'findingId']); return { kind, source, runId: id(v.runId), findingId: id(v.findingId) }; }
    if (kind === 'external_opinion') { object(v, ['kind', 'source', 'agency', 'reviewer']); return { kind, source, agency: str(v.agency, 200, true), reviewer: str(v.reviewer, 200, true) }; }
    object(v, ['kind', 'source', 'reviewer']);
    return { kind, source, reviewer: str(v.reviewer, 200, true) };
}
function opinion(value: unknown): OpinionInput {
    const v = object(value, ['target', 'source', 'originalText', 'internalFileVersionIds', 'receivedOn', 'conflictingOpinionVersionIds']);
    return { target: parseReviewTarget(v.target), source: parseOpinionSource(v.source), originalText: rawText(v.originalText, correctionLimits.originalText), internalFileVersionIds: ids(v.internalFileVersionIds), receivedOn: nullableDate(v.receivedOn), conflictingOpinionVersionIds: ids(v.conflictingOpinionVersionIds) };
}
export function parseBatchDraft(value: unknown): BatchDraftInput {
    const v = object(value, ['title', 'summary', 'items', 'mode', 'pendingScopes', 'previousBatchVersionId']);
    const items = distinctKeys(list(v.items, correctionLimits.items).map(value => {
        const i = object(value, ['key', 'target', 'internalOpinionVersionIds', 'publicSource', 'change', 'reason', 'publicDescription', 'priority', 'issue']);
        return { key: id(i.key), target: parseReviewTarget(i.target), internalOpinionVersionIds: ids(i.internalOpinionVersionIds), publicSource: rawText(i.publicSource, 2000), change: rawText(i.change, correctionLimits.publicText), reason: rawText(i.reason, correctionLimits.publicText), publicDescription: rawText(i.publicDescription, correctionLimits.publicText), priority: enumValue(i.priority, ['low', 'normal', 'high', 'urgent']), issue: enumValue(i.issue, ['correction', 'conflicting_opinions', 'wrong_file', 'missing_content']) } satisfies CorrectionItemDraft;
    }));
    const pendingScopes = list(v.pendingScopes, correctionLimits.pendingScopes).map(value => { const p = object(value, ['agency', 'scope', 'expectedOn']); return { agency: str(p.agency, 200, true), scope: str(p.scope, 2000, true), expectedOn: nullableDate(p.expectedOn) }; });
    return { title: rawText(v.title, correctionLimits.title), summary: rawText(v.summary, correctionLimits.publicText), items, mode: enumValue(v.mode, ['normal', 'urgent_partial']), pendingScopes, previousBatchVersionId: nullableId(v.previousBatchVersionId) };
}
/** Call on saved draft before publish, in addition to authoritative relation/auth/CAS checks. */
export function assertPublishableDraft(draft: BatchDraftInput): void {
    // Reparse untrusted stored input. Static TypeScript annotations are not runtime validation.
    const d = parseBatchDraft(draft);
    if (!d.title.trim() || !d.items.length) fail('VALIDATION', 422, '공개할 제목과 수정항목을 입력해 주세요.');
    if (d.mode === 'urgent_partial' && !d.pendingScopes.length) fail('VALIDATION', 422, '긴급 부분 공개의 대기 기관과 범위를 기록해 주세요.');
    for (const i of d.items) {
        if (![i.publicSource, i.change, i.reason, i.publicDescription].every(x => x.trim()) || !i.internalOpinionVersionIds.length) fail('VALIDATION', 422, '공개 설명과 수정 내용·이유·출처를 확인해 주세요.');
        if (i.issue === 'conflicting_opinions' && i.internalOpinionVersionIds.length < 2) fail('VALIDATION', 422, '상충하는 의견의 출처를 각각 연결해 주세요.');
    }
}
export function parseSaveOpinion(value: unknown): SaveOpinionCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'opinionId', 'expectedRevision', 'opinion']), identity = commandIdentity(v), opinionId = nullableId(v.opinionId), parsed = opinion(v.opinion);
    sameTask(parsed.target, identity.taskId);
    return { ...identity, opinionId, expectedRevision: creatingOrEditing(opinionId, v.expectedRevision), opinion: parsed };
}
export function parseSaveBatchDraft(value: unknown): SaveBatchDraftCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'draftId', 'expectedRevision', 'draft']), identity = commandIdentity(v), draftId = nullableId(v.draftId), draft = parseBatchDraft(v.draft);
    for (const i of draft.items) sameTask(i.target, identity.taskId);
    return { ...identity, draftId, expectedRevision: creatingOrEditing(draftId, v.expectedRevision), draft };
}
export function parsePublishBatch(value: unknown): PublishBatchCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'draftId', 'expectedRevision']);
    return { ...commandIdentity(v), draftId: id(v.draftId), expectedRevision: revision(v.expectedRevision, false) };
}
export function parseReflectItems(value: unknown): ReflectItemsCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'batchVersionId', 'items']), identity = commandIdentity(v);
    const items = nonempty(list(v.items, correctionLimits.items)).map(value => {
        const i = object(value, ['itemKey', 'expectedItemRevision', 'target', 'note']), target = parseReviewTarget(i.target); sameTask(target, identity.taskId);
        return { itemKey: id(i.itemKey), expectedItemRevision: revision(i.expectedItemRevision), target, note: rawText(i.note, correctionLimits.publicText) };
    });
    distinctKeys(items.map(i => ({ key: i.itemKey })));
    return { ...identity, batchVersionId: id(v.batchVersionId), items };
}
export function parseResolveItems(value: unknown): ResolveItemsCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'batchVersionId', 'items']);
    const items = nonempty(list(v.items, correctionLimits.items)).map(value => {
        const i = object(value, ['itemKey', 'expectedItemRevision', 'reflectionId', 'decision', 'reason']), decision = enumValue(i.decision, ['resolved', 'needs_confirmation', 'not_reflected']);
        return { itemKey: id(i.itemKey), expectedItemRevision: revision(i.expectedItemRevision), reflectionId: id(i.reflectionId), decision, reason: str(i.reason, correctionLimits.publicText, decision !== 'resolved') };
    });
    distinctKeys(items.map(i => ({ key: i.itemKey })));
    return { ...commandIdentity(v), batchVersionId: id(v.batchVersionId), items };
}
export function parseRecordReview(value: unknown): RecordReviewCommand {
    const v = object(value, ['taskId', 'idempotencyKey', 'target', 'source', 'scope', 'receivedOn', 'result', 'rationale', 'evidenceFileVersionIds', 'previousReviewId']), identity = commandIdentity(v), target = parseReviewTarget(v.target), scope = object(v.scope, ['medium', 'language', 'usePlace', 'productIds']);
    sameTask(target, identity.taskId);
    return { ...identity, target, source: parseOpinionSource(v.source), scope: { medium: str(scope.medium, 200, true), language: str(scope.language, 100, true), usePlace: str(scope.usePlace, 1000, true), productIds: ids(scope.productIds) }, receivedOn: dateValue(v.receivedOn), result: enumValue(v.result, ['no_changes_requested', 'changes_requested', 'needs_confirmation', 'opinion_only']), rationale: str(v.rationale, correctionLimits.originalText, true), evidenceFileVersionIds: ids(v.evidenceFileVersionIds), previousReviewId: nullableId(v.previousReviewId) };
}
