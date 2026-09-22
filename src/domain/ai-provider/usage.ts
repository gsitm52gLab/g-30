import type { Cost, Usage } from './types';
export const PRICING_VERSION = 'openai-gpt-6-astra-standard-2026-09-22';
const bag = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function providerUsage(raw: unknown): Usage { const v = bag(raw), i = bag(v.input_tokens_details), o = bag(v.output_tokens_details); return { inputTokens: count(v.input_tokens), cachedTokens: count(i.cached_tokens), cacheWriteTokens: count(i.cache_write_tokens), outputTokens: count(v.output_tokens), reasoningTokens: count(o.reasoning_tokens), totalTokens: count(v.total_tokens) }; }
export function estimateCost(usage: Usage, requestedModel: string, responseModel: string | null, tier: string | null): Cost {
 const base: Cost = { amountUsd: null, unavailableReason: null, pricingVersion: PRICING_VERSION, asOf: '2026-09-22', model: requestedModel, currency: 'USD', estimated: true, tier, rates: null };
 if (requestedModel !== 'gpt-6-astra' || responseModel !== requestedModel || tier !== 'default') return { ...base, unavailableReason: 'MODEL_OR_TIER_UNMATCHED' };
 const { inputTokens: i, cachedTokens: c, cacheWriteTokens: w, outputTokens: o, reasoningTokens: r, totalTokens: t } = usage;
 if ([i,c,w,o,r,t].some(v => v === null || !Number.isSafeInteger(v) || v < 0)) return { ...base, unavailableReason: 'USAGE_UNAVAILABLE' };
 if (c! + w! > i! || r! > o! || i! + o! !== t!) return { ...base, unavailableReason: 'USAGE_INCONSISTENT' };
 const rates = i! > 272_000 ? { input: 20, cached: 2, cacheWrite: 25, output: 75 } : { input: 10, cached: 1, cacheWrite: 12.5, output: 50 };
 return { ...base, rates, amountUsd: ((i! - c! - w!) * rates.input + c! * rates.cached + w! * rates.cacheWrite + o! * rates.output) / 1_000_000 };
}
