import type { PriorSubmissionData, RequestContent } from './types';
import { evaluateAnswers } from '../submissions/evaluate';
import type { AnswerInput } from '../submissions/types';
/** Preserve original fixture rows; translate only known typed shapes at the read boundary. */
export function evaluateRequirements(current: RequestContent, prior: PriorSubmissionData | null, previous: RequestContent | null) {
    const answers: AnswerInput[] = (prior?.answers ?? []).flatMap(answer => {
        const q = (previous ?? current).requirements.find(r => r.key === answer.requirementKey);
        if (!q) return [];
        const value = answer.value;
        let input: unknown = value;
        if (q.type === 'short_text' || q.type === 'long_text') input = { text: value };
        if (q.type === 'number') input = { value: typeof value === 'number' && Number.isFinite(value) ? String(value) : value };
        if (q.type === 'choice') input = { selected: typeof value === 'string' ? [value] : value };
        if (q.type === 'file') input = { fileVersionIds: answer.fileVersionIds };
        return [{ requestId: prior!.requestId, requirementKey: answer.requirementKey, productId: answer.productId, type: q.type, input } as AnswerInput];
    });
    return evaluateAnswers(current, answers, previous, true).items;
}
