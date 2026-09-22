/** Provider facts are separate from logical G16 runs and from a durable dispatch intention. */
export const PROVIDER_LIMITS = { timeoutMs: 45_000, leaseMs: 90_000, attempts: 3, actorContextPerMinute: 6, concurrent: 2, queued: 16, inputBytes: 65_536, requestBytes: 131_072, maxOutputTokens: 3_000 } as const;
export const PROMPT_VERSION = 'gs-hale-provider-review/1';
export const PROVIDER_ISSUES = ['KEY_MISSING', 'CONFIGURATION', 'DISABLED', 'PROVIDER_AUTH', 'PROVIDER_PERMISSION', 'RATE_LIMIT', 'SERVER_ERROR', 'TIMEOUT', 'NETWORK', 'REFUSAL', 'INCOMPLETE', 'PARSE_ERROR', 'EXTERNAL_USE_DENIED', 'INPUT_LIMIT', 'SOURCE_CHANGED', 'CORPUS_CHANGED', 'ACCESS_CHANGED', 'SETTINGS_CHANGED', 'INTERRUPTED', 'RESPONSE_UNKNOWN', 'ENGINE_ERROR'] as const;
export type ProviderIssue = typeof PROVIDER_ISSUES[number];
export type Usage = { inputTokens: number | null; cachedTokens: number | null; cacheWriteTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; totalTokens: number | null };
export type Cost = { amountUsd: number | null; unavailableReason: string | null; pricingVersion: string; asOf: string; model: string; currency: 'USD'; estimated: true; tier: string | null; rates: { input: number; cached: number; cacheWrite: number; output: number } | null };
export interface ProviderRecords {
 aiProviderSetting: { enabled: boolean; changedBy: string };
 aiProviderPlan: { runId: string; settingRevision: number; model: string; baseURL: string; promptVersion: string; settingsEnabled: boolean; maxOutputTokens: number; timeoutMs: number; pricingVersion: string };
 aiProviderAttempt: { runId: string; sequence: number; actorId: string; claimId: string; phase: 'intent' | 'dispatched' | 'settled'; intentAt: string; dispatchedAt: string | null; leaseUntil: string; requestHash: string | null; inputBytes: number | null; approximateInputTokens: number | null; outcomeId: string | null };
 aiProviderOutcome: { attemptId: string; runId: string; endedAt: string; issue: ProviderIssue | null; responseId: string | null; requestId: string | null; responseModel: string | null; serviceTier: string | null; providerStatus: string | null; responseHash: string | null; rawCandidate: string | null; usage: Usage; cost: Cost; remoteOutcomeUnknown: boolean; schemaValid: boolean; grounding: 'confirmed' | 'insufficient' | 'not_judged' };
}
