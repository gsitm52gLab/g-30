import { fail } from '@/server/auth/errors';
import type { Available, CompletionBasis, CorrectionFact, EvaluationFact, InquiryFact, ProductUseFact } from '@/domain/completion/types';
import * as parse from '@/domain/completion/validate';
export function corrupt(): never { return fail('STORAGE_UNAVAILABLE', 503, '저장된 완료 기록을 확인할 수 없습니다. 원본을 보존하고 GSG에 확인을 요청해 주세요.'); }
export function text(v: unknown, max = 4000): string { if (typeof v !== 'string' || v.length > max)
    corrupt(); return v; }
export function id(v: unknown) { const x = text(v, 160); if (!/^[\w-]+$/.test(x))
    corrupt(); return x; }
export const nullableId = (v: unknown) => v === null ? null : id(v);
export function count(v: unknown, min = 0): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min)
    corrupt(); return v; }
export function bool(v: unknown): boolean { if (typeof v !== 'boolean')
    corrupt(); return v; }
export function hash(v: unknown) { const x = text(v, 64); if (!/^[a-f0-9]{64}$/.test(x))
    corrupt(); return x; }
export function time(v: unknown) { const x = text(v, 60); if (!Number.isFinite(Date.parse(x)))
    corrupt(); return x; }
export function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    corrupt(); return v as Record<string, unknown>; }
export function array(v: unknown): unknown[] { if (!Array.isArray(v) || v.length > 20000)
    corrupt(); return v; }
export function choice<T extends string>(v: unknown, values: readonly T[]): T { if (typeof v !== 'string' || !values.includes(v as T))
    corrupt(); return v as T; }
const pick = (v: unknown, keys: string[]) => { const o = object(v); return Object.fromEntries(keys.map(k => [k, o[k]])); };
const guard = <T>(fn: () => T) => { try {
    return fn();
}
catch {
    return corrupt();
} };
export const actor = (v: unknown) => guard(() => { const x = object(v); return parse.actor(pick(v, x.kind === 'user' ? ['kind', 'userId'] : ['kind', 'label', 'source'])); });
export const observed = (v: unknown) => v === null ? null : guard(() => parse.observed(pick(v, ['value', 'precision', 'timezone', 'source'])));
export const source = (v: unknown) => guard(() => parse.source(pick(v, ['requestId', 'submissionId', 'submissionContentHash', 'fileVersionIds', 'productUseIds'])));
export function external(v: unknown) { const x = object(v); return guard(() => parse.external({ ...pick(x, ['purpose', 'destination', 'evidenceFileVersionIds', 'latestProgress', 'waitingExternal', 'visibility']), requester: actor(x.requester), performer: actor(x.performer), source: source(x.source), observedAt: observed(x.observedAt) })); }
export function evaluation(v: unknown): EvaluationFact { const x = object(v); return { required: count(x.required), satisfied: count(x.satisfied), missing: count(x.missing), invalid: count(x.invalid), humanReviewPending: bool(x.humanReviewPending) }; }
export function productUse(v: unknown): ProductUseFact { const x = object(v); return { id: id(x.id), productId: id(x.productId), productVersionId: id(x.productVersionId), contextProductVersionId: id(x.contextProductVersionId), retailPriceVersionId: nullableId(x.retailPriceVersionId), contentHash: hash(x.contentHash), fileBindingHash: hash(x.fileBindingHash) }; }
export function inquiry(v: unknown): InquiryFact { const x = object(v), e = x.externalWait === null ? null : object(x.externalWait); return { conversationId: id(x.conversationId), questionId: id(x.questionId), revision: count(x.revision, 1), text: text(x.text, 20000), state: choice(x.state, ['resolved', 'gsg_waiting', 'brand_supplement_waiting', 'external_waiting']), externalWait: e ? { counterparty: text(e.counterparty, 1000), sentAt: e.sentAt === null ? null : time(e.sentAt), responsibleLabel: text(e.responsibleLabel, 200), nextCheckDate: text(e.nextCheckDate, 10), timezone: text(e.timezone, 100), latestResult: text(e.latestResult, 4000) } : null }; }
export function correction(v: unknown): CorrectionFact { const x = object(v); return { batchVersionId: id(x.batchVersionId), itemKey: id(x.itemKey), targetSubmissionId: id(x.targetSubmissionId), status: choice(x.status, ['pending', 'needs_confirmation', 'reflected', 'resolved', 'not_reflected']), reflectionId: nullableId(x.reflectionId), resolutionId: nullableId(x.resolutionId) }; }
function available<T>(v: unknown, project: (x: unknown) => T): Available<T> { const x = object(v); if (x.connected !== true)
    corrupt(); if (x.state === 'unavailable') {
    if (x.value !== null || x.reason !== 'source_unavailable')
        corrupt();
    return { connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' };
} if (x.state !== 'available')
    corrupt(); return { connected: true, state: 'available', value: project(x.value) }; }
export function basis(v: unknown): CompletionBasis {
    const x = object(v), request = x.currentRequest === null ? null : object(x.currentRequest), submission = x.latestSubmission === null ? null : object(x.latestSubmission);
    const notConnected = (v: unknown) => { const a = object(v); if (a.connected !== false || a.state !== 'not_connected' || a.value !== null)
        corrupt(); return { connected: false as const, state: 'not_connected' as const, value: null }; };
    return { currentRequest: request ? { id: id(request.id), sequence: count(request.sequence, 1) } : null, currentRequestUnavailable: bool(x.currentRequestUnavailable), latestSubmission: submission ? { id: id(submission.id), requestId: id(submission.requestId), sequence: count(submission.sequence, 1), mode: choice(submission.mode, ['partial', 'full']), contentHash: hash(submission.contentHash), submittedAt: time(submission.submittedAt), fileVersionIds: array(submission.fileVersionIds).map(id), products: available(submission.products, v => array(v).map(productUse)) } : null, latestMatchesCurrentRequest: x.latestMatchesCurrentRequest === null ? null : bool(x.latestMatchesCurrentRequest), currentEvaluation: available(x.currentEvaluation, evaluation), originalSubmittedEvaluation: available(x.originalSubmittedEvaluation, evaluation), currentProducts: available(x.currentProducts, v => array(v).map(v => { const p = object(v); return { productId: id(p.productId), productVersionId: id(p.productVersionId), contextProductVersionId: id(p.contextProductVersionId), commonRevision: count(p.commonRevision, 1), contextRevision: count(p.contextRevision, 1) }; })), inquiries: available(x.inquiries, v => { const a = object(v); return { items: array(a.items).map(inquiry), unresolved: count(a.unresolved), externalWaiting: count(a.externalWaiting) }; }), corrections: available(x.corrections, v => { const a = object(v); return { items: array(a.items).map(correction), unresolved: count(a.unresolved), pendingScopes: array(a.pendingScopes).map(v => { const p = object(v); return { batchVersionId: id(p.batchVersionId), agency: text(p.agency, 500), scope: text(p.scope, 2000), expectedOn: p.expectedOn === null ? null : text(p.expectedOn, 10) }; }) }; }), externalActions: array(x.externalActions).map(v => { const a = object(v); return { id: id(a.id), visibility: choice(a.visibility, ['public', 'internal']), purpose: choice(a.purpose, ['review_request', 'application', 'final_use']), latestProgress: text(a.latestProgress), waitingExternal: bool(a.waitingExternal), observedAt: observed(a.observedAt), recordedAt: time(a.recordedAt) }; }), campaign: notConnected(x.campaign), ai: notConnected(x.ai) };
}
export const taskStatus = (v: unknown) => choice(v, ['draft', 'requested', 'in_progress', 'partial', 'submitted', 'completed', 'on_hold', 'cancelled']);
