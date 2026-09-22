import { describe, expect, it } from 'vitest';
import { jsonContentEqual } from '@/domain/json-content';
import { outcomeData } from '@/domain/ai-provider/parse';
import { estimateCost, providerUsage } from '@/domain/ai-provider/usage';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { compatibleRequirement, evaluateAnswers } from '@/domain/submissions/evaluate';

function reordered<T>(value: T): T {
    if (Array.isArray(value)) return value.map(reordered) as T;
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reordered(v)])) as T;
    return value;
}

describe('JSONB object-order durability at actual consumer boundaries', () => {
    it('stored provider cost accepts reordered keys while refusing changed cost and extra fields', () => {
        const usage = providerUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1100 });
        const cost = estimateCost(usage, 'gpt-6-astra', 'gpt-6-astra', 'default');
        const original = { attemptId: 'attempt_test', runId: 'run_test', endedAt: '2026-09-22T00:00:00Z', issue: null, responseId: null, requestId: null, responseModel: 'gpt-6-astra', serviceTier: 'default', providerStatus: 'completed', responseHash: null, rawCandidate: null, usage, cost, remoteOutcomeUnknown: false, schemaValid: true, grounding: 'insufficient' };
        expect(outcomeData(reordered(original), 'gpt-6-astra')).toEqual(outcomeData(original, 'gpt-6-astra'));
        expect(() => outcomeData({ ...reordered(original), cost: { ...reordered(cost), amountUsd: 0 } }, 'gpt-6-astra')).toThrow();
        expect(() => outcomeData({ ...original, cost: { ...cost, hiddenExtra: 'not allowed' } }, 'gpt-6-astra')).toThrow();
    });
    it('reordered stored request rules retain the actual submission compatibility and denominator', () => {
        const current = blankContent(), q = blankRequirement('body', 'long_text');
        q.label = '본문'; q.required = true;
        q.specifications = [{ text: '원문 표기', severity: 'required', source: 'fixture', version: 'v1', check: 'human' }];
        current.requirements = [q];
        const saved = reordered(current);
        expect(compatibleRequirement(q, current, saved)).toBe(true);
        expect(evaluateAnswers(current, [], saved)).toEqual(evaluateAnswers(current, [], current));
        saved.requirements[0].specifications[0].text = '달라진 규격';
        expect(compatibleRequirement(q, current, saved)).toBe(false);
    });
    it('answer/source content keeps array order, null and literal values significant', () => {
        const source = { answer: { type: 'choice', selected: ['a', 'b'] }, source: { id: 'exact', version: 'v1' } };
        expect(jsonContentEqual(source, reordered(source))).toBe(true);
        expect(jsonContentEqual(source, { ...source, answer: { type: 'choice', selected: ['b', 'a'] } })).toBe(false);
        expect(jsonContentEqual({ a: null }, {})).toBe(false);
        expect(jsonContentEqual({ a: '1' }, { a: 1 })).toBe(false);
    });
});
