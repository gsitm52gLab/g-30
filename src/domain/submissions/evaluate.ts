import { jsonContentEqual } from '@/domain/json-content';
import type { RequestContent, Requirement } from '../tasks/types';
import type { AnswerInput, Evaluation, RequirementEvaluation } from './types';
import { answerKey } from './types';
import { normalizeAnswer } from './validate';
function signature(q: Requirement, content: RequestContent, seen = new Set<string>()): unknown {
    if (seen.has(q.key))
        return null;
    const parent = q.condition ? content.requirements.find(r => r.key === q.condition!.key) : null;
    return { type: q.type, options: q.options, unit: q.unit, productIds: [...q.productIds].sort(), specifications: q.specifications,
        required: q.required, condition: q.condition, parent: parent ? signature(parent, content, new Set(seen).add(q.key)) : null };
}
export function compatibleRequirement(q: Requirement, current: RequestContent, previous: RequestContent | null): boolean {
    const old = previous?.requirements.find(r => r.key === q.key);
    return !!old && jsonContentEqual(signature(q, current), signature(old, previous!));
}
/** One evaluator for live drafts/submissions and the G04 legacy evidence adapter. */
export function evaluateAnswers(current: RequestContent, answers: AnswerInput[], previous: RequestContent | null = current, prior = false): Evaluation {
    const values = new Map(answers.map(a => [answerKey(a), a]));
    function applicable(q: Requirement, productId: string | null, seen = new Set<string>()): boolean {
        if (seen.has(q.key) || q.productIds.length && (!productId || !q.productIds.includes(productId)))
            return false;
        if (!q.condition)
            return true;
        const parent = current.requirements.find(r => r.key === q.condition!.key);
        if (!parent)
            return false;
        const pid = parent.productIds.length ? productId : null;
        if (!applicable(parent, pid, new Set(seen).add(q.key)))
            return false;
        const answer = values.get(answerKey({ requirementKey: parent.key, productId: pid }));
        const normalized = normalizeAnswer(parent, answer);
        return normalized.validity === 'valid' && parent.type === 'choice' && !!normalized.input && 'selected' in normalized.input && normalized.input.selected.includes(q.condition.equals);
    }
    const items: RequirementEvaluation[] = current.requirements.flatMap(q => (q.productIds.length ? q.productIds : [null]).map(productId => {
        const answer = values.get(answerKey({ requirementKey: q.key, productId })), applies = applicable(q, productId), normalized = normalizeAnswer(q, answer);
        const changed = !!answer && !compatibleRequirement(q, current, previous);
        return { requirementKey: q.key, productId, label: q.label, type: q.type, required: q.required,
            status: !applies ? 'not_applicable' : changed ? 'needs_reconfirmation' : normalized.validity === 'invalid' ? 'invalid' : normalized.validity === 'valid' ? prior ? 'prior_received' : 'received' : q.required ? 'missing' : 'optional',
            validity: normalized.validity, issues: applies ? normalized.issues : [], humanReviewPending: applies && q.specifications.length > 0,
            warnings: applies ? q.specifications.map(spec => `${spec.severity === 'recommended' ? '권장' : '필수'} 규격 · ${spec.text} · ${spec.source} ${spec.version} · 사람 확인 필요`) : [], sourceRequestId: answer?.requestId ?? null };
    }));
    const required = items.filter(r => r.required && r.status !== 'not_applicable'), satisfied = required.filter(r => r.status === 'received' || r.status === 'prior_received').length;
    const invalid = items.filter(r => r.status === 'invalid' || r.status === 'needs_reconfirmation').length;
    return { items, required: required.length, satisfied, missing: required.length - satisfied, invalid, canSubmitFull: required.length === satisfied && invalid === 0, humanReviewPending: items.some(r => r.humanReviewPending) };
}
