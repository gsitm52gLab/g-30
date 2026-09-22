import { requestRequirementsValid } from '@/domain/submissions/request';
import type { RequestContent } from '@/domain/tasks/types';
import { projectedRequest } from '@/server/tasks/projection';
import { evaluateAnswers } from '@/domain/submissions/evaluate';
import type { AnswerInput, DateInput, LinkInput, Provider, StoredAnswer, DraftContent } from '@/domain/submissions/types';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { fileMetadata, fileUrls } from '@/server/files/service';
import { canReferenceFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { unavailable } from '@/server/auth/errors';
import { userLabel } from './access';
export { contentFiles } from '@/domain/submissions/files';
const text = (v: unknown) => typeof v === 'string' ? v : '';
const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
export const dateDTO = (v: DateInput): DateInput => ({ value: text(v.value), precision: v.precision === 'datetime' ? 'datetime' : 'date', timezone: text(v.timezone) });
export const linkDTO = (v: LinkInput): LinkInput => ({ url: text(v.url), description: text(v.description), contentFixed: false, fixedReference: !v.fixedReference ? null : v.fixedReference.kind === 'file' ? { kind: 'file', fileVersionId: text(v.fixedReference.fileVersionId) } : { kind: 'external', identifier: text(v.fixedReference.identifier), source: text(v.fixedReference.source) } });
/** Explicit recursive output projection; stored nested extensions never become API fields. */
export function answerDTO(a: AnswerInput): AnswerInput {
    const address = { requestId: text(a.requestId), requirementKey: text(a.requirementKey), productId: typeof a.productId === 'string' ? a.productId : null };
    switch (a.type) {
        case 'short_text':
        case 'long_text': return { ...address, type: a.type, input: { text: text(a.input.text) } };
        case 'number': return { ...address, type: a.type, input: { value: text(a.input.value) } };
        case 'choice': return { ...address, type: a.type, input: { selected: strings(a.input.selected) } };
        case 'file': return { ...address, type: a.type, input: { fileVersionIds: strings(a.input.fileVersionIds) } };
        case 'date': return { ...address, type: a.type, input: dateDTO(a.input) };
        case 'link': return { ...address, type: a.type, input: linkDTO(a.input) };
        case 'physical_record': return { ...address, type: a.type, input: { summary: text(a.input.summary), source: text(a.input.source), items: a.input.items.map(i => ({ productId: typeof i.productId === 'string' ? i.productId : null, quantity: text(i.quantity), unit: text(i.unit) })), evidenceFileVersionIds: strings(a.input.evidenceFileVersionIds), observedAt: a.input.observedAt ? dateDTO(a.input.observedAt) : null } };
    }
}
export async function providerDTO(s: UnitOfWork, p: Principal, contextId: string, v: Provider) {
    return v.kind === 'user' ? { kind: 'user' as const, userId: text(v.userId), label: (await userLabel(s, p, contextId, v.userId)) } : { kind: 'external_source' as const, label: text(v.label), source: text(v.source) };
}
export async function storedAnswerDTO(s: UnitOfWork, p: Principal, contextId: string, a: StoredAnswer) {
    return { ...answerDTO(a), provenance: { providedBy: (await providerDTO(s, p, contextId, a.provenance.providedBy)), recordedBy: text(a.provenance.recordedBy), recorderLabel: (await userLabel(s, p, contextId, a.provenance.recordedBy)), at: text(a.provenance.at), originSubmissionId: typeof a.provenance.originSubmissionId === 'string' ? a.provenance.originSubmissionId : null } };
}
export function contentDTO(d: DraftContent): DraftContent {
    return { answers: d.answers.map(answerDTO), narrative: text(d.narrative), artifacts: d.artifacts.map(a => ({ fileVersionId: text(a.fileVersionId), role: a.role === 'editable_original' || a.role === 'review_copy' ? a.role : 'evidence', answer: a.answer ? { requirementKey: text(a.answer.requirementKey), productId: typeof a.answer.productId === 'string' ? a.answer.productId : null } : null })), links: d.links.map(linkDTO), productSelections: d.productSelections.map(v => ({ productId: text(v.productId), expectedCommonRevision: v.expectedCommonRevision, expectedContextRevision: v.expectedContextRevision, bindingIds: strings(v.bindingIds), retailPriceVersionId: typeof v.retailPriceVersionId === 'string' ? v.retailPriceVersionId : null, asOfDate: text(v.asOfDate) })) };
}
export async function publicFile(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, id: string, clock: Clock) {
    const file = (await s.get('fileVersion', id));
    if (!file || file.data.visibility !== 'public')
        unavailable();
    (await canReferenceFile(s, p, file, taskScope(task), clock));
    return file;
}
export async function fileDTO(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, id: string, clock: Clock) {
    const f = (await publicFile(s, p, task, id, clock));
    return { ...fileMetadata(f), ...fileUrls(f, task.id), uploaderLabel: (await userLabel(s, p, task.contextId!, f.data.uploaderId)), uploadedAt: f.createdAt };
}
/** Sanitize stored legacy/extensions before deriving a public evaluation, too. */
export function safeEvaluation(current: RequestContent, answers: AnswerInput[], previous: RequestContent | null = current, prior = false, approvedEmpty = false) {
    const content = (value: RequestContent): RequestContent => ({ ...projectedRequest(value, false, []), internalOriginal: '', internalMemo: '' });
    const result = evaluateAnswers(content(current), answers.map(answerDTO), previous ? content(previous) : null, prior);
    if (!requestRequirementsValid(current, approvedEmpty))
        return { ...result, satisfied: 0, missing: result.required, invalid: Math.max(1, result.invalid), canSubmitFull: false, humanReviewPending: true, items: result.items.map(item => ({ ...item, status: 'needs_reconfirmation' as const, humanReviewPending: true, warnings: [...item.warnings, '공개 요청 구조 확인 필요'] })) };
    return result;
}
