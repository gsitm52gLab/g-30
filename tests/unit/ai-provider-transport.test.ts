import { afterEach, describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { openaiTransport } from '@/server/ai-provider/transport';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { openDatabase, migrate } from '@/server/db/database';
import { AiProviderService } from '@/server/ai-provider/service';
import { SYNTHETIC_TEXT } from '@/server/ai-input/provenance';
import { policyFixture, NOW } from '../fixtures/policy';
import { staff, readyInput, inputContent } from '../fixtures/ai-review/server';
import { candidateSchema } from '@/domain/ai-provider/schema';
const config = { apiKey: 'SYNTHETIC_TRANSPORT_SECRET', model: 'gpt-6-astra', baseURL: 'https://api.openai.com/v1' };
const request = { model: config.model, instructions: 'synthetic', input: [{ role: 'user' as const, content: [{ type: 'input_text' as const, text: 'synthetic only' }] }], reasoning: { effort: 'low' as const }, text: { format: { type: 'json_schema' as const, name: 'gs_hale_ai_review_v1', strict: true, schema: candidateSchema } }, max_output_tokens: 3000 as const, store: false, stream: false as const, background: false, service_tier: 'default' as const, truncation: 'disabled' as const };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('actual SDK transport with intercepted fetch; no network', () => {
    for (const status of [401, 403, 429, 500, 400])
        it(`AC17-01 SDK ${status} classification strips unsafe body and retries0`, async () => { let calls = 0, dispatched = 0, before = 0; vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ error: { message: 'SYNTHETIC_TRANSPORT_SECRET unsafe server echo', type: 'synthetic' } }), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_fault' } }); }); const r = await openaiTransport(config, request, async () => { before++; }, async () => { dispatched++; }); expect(r.issue).toBe(({ 401: 'PROVIDER_AUTH', 403: 'PROVIDER_PERMISSION', 429: 'RATE_LIMIT', 500: 'SERVER_ERROR', 400: 'CONFIGURATION' } as Record<number, string>)[status]); expect(calls).toBe(1); expect(before).toBe(1); expect(dispatched).toBe(1); expect(JSON.stringify(r)).not.toContain('SYNTHETIC_TRANSPORT_SECRET'); expect(r.usage.inputTokens).toBeNull(); });
    it('AC17-05 response extraction follows message parts, captures provided usage/request ID without unknown fields', async () => { vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => { const body = JSON.parse(String(init.body)); expect(body.store).toBe(false); expect(body.reasoning.effort).toBe('low'); expect(body.text.format.strict).toBe(true); return new Response(JSON.stringify({ object: 'response', id: 'resp_fixture', model: 'gpt-6-astra', service_tier: 'default', status: 'completed', unknownPrivate: 'SHOULD_NOT_PROJECT', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"schemaVersion":"gs-hale-ai-review/1","findings":[]}' }] }], usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 3 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 2 }, total_tokens: 30 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture' } }); }); const r = await openaiTransport(config, request, async () => { }, async () => { }); expect(r).toMatchObject({ issue: null, responseId: 'resp_fixture', requestId: 'req_fixture', usage: { inputTokens: 20, cacheWriteTokens: 3, reasoningTokens: 2 } }); expect(JSON.stringify(r)).not.toContain('SHOULD_NOT_PROJECT'); });
    for (const [status, content, issue] of [['completed', [{ type: 'refusal', refusal: 'refuse' }], 'REFUSAL'], ['incomplete', [], 'INCOMPLETE'], ['completed', [], 'PARSE_ERROR']] as const)
        it(`AC17-01 ${issue} is not successful empty output`, async () => { vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ object: 'response', id: 'resp_fixture', model: 'gpt-6-astra', service_tier: 'default', status, output: [{ type: 'message', content }] }), { headers: { 'content-type': 'application/json' } })); expect((await openaiTransport(config, request, async () => { }, async () => { })).issue).toBe(issue); });
});
describe('C17-S01 actual SDK parsed malformed responses keep provided facts', () => {
    for (const output of [undefined, [{ type: 'message', content: null }], [{ type: 'message', content: [{ type: 'output_text', text: { bad: 'nested' } }] }]])
        it('malformed output keeps response identity and usage while failing parsing', async () => { vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ id: 'resp_bad_shape', model: 'gpt-6-astra', service_tier: 'default', status: 'completed', output, usage: { input_tokens: 11, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 2 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 }, total_tokens: 18 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'req_bad_shape' } })); const r = await openaiTransport(config, request, async () => { }, async () => { }); expect(r).toMatchObject({ issue: 'PARSE_ERROR', responseId: 'resp_bad_shape', requestId: 'req_bad_shape', responseModel: 'gpt-6-astra', providerStatus: 'completed', usage: { inputTokens: 11, cacheWriteTokens: 2, outputTokens: 7, reasoningTokens: 3, totalTokens: 18 } }); expect(r.rawCandidate).toBeNull(); });
});
// Actual object discriminator invokes SDK7.20 responses.create's addOutputText transform.
const usageFixture = { input_tokens: 11, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 2 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 }, total_tokens: 18 };
const malformedOutputs = [{ kind: 'output-object', output: {} }, { kind: 'content-object', output: [{ type: 'message', role: 'assistant', content: {} }] }];
function envelope(output: unknown, usage: unknown = usageFixture) { return { object: 'response', id: 'resp_real_envelope', model: 'gpt-6-astra', service_tier: 'default', status: 'completed', output, usage, unknownPrivate: 'PRIVATE_PROVIDER_BODY_NOT_TO_STORE' }; }
function response(body: unknown) { return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'x-request-id': 'req_real_envelope' } }); }
describe('G17-V01 actual response discriminator and durable safe projection', () => {
    for (const f of malformedOutputs)
        it(`G17-V01 ${f.kind} received parseable response retains safe metadata`, async () => { let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return response(envelope(f.output)); }); const r = await openaiTransport(config, request, async () => { }, async () => { }); expect(r).toMatchObject({ issue: 'PARSE_ERROR', responseId: 'resp_real_envelope', requestId: 'req_real_envelope', responseModel: 'gpt-6-astra', serviceTier: 'default', providerStatus: 'completed', remoteOutcomeUnknown: false, rawCandidate: null, usage: { inputTokens: 11, cachedTokens: 0, cacheWriteTokens: 2, outputTokens: 7, reasoningTokens: 3, totalTokens: 18 } }); expect(r.responseHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(r)).not.toContain('PRIVATE_PROVIDER_BODY_NOT_TO_STORE'); expect(calls).toBe(1); });
    for (const mode of ['mock', 'sqlite'] as const)
        for (const f of malformedOutputs)
            it(`G17-V01 ${mode} ${f.kind} persists provided usage and nullable cost without a result`, async () => { const directory = await mkdtemp(path.join(os.tmpdir(), 'g17-v01-')); const repo = mode === 'mock' ? createMockRepository(() => NOW) : (() => { const db = openDatabase(':memory:', true); migrate(db); return createSqliteRepository(db, () => NOW); })(); try {
                const identity = await policyFixture(repo), input = await readyInput(identity, directory, inputContent(SYNTHETIC_TEXT));
                let calls = 0;
                const usage = f.kind === 'output-object' ? usageFixture : { ...usageFixture, input_tokens_details: { cached_tokens: 0 } };
                vi.stubGlobal('fetch', async () => { calls++; return response(envelope(f.output, usage)); });
                const service = new AiProviderService(identity, directory, { config: () => ({ config, issue: null }) });
                const result = await service.start(staff, input.input.id, { ...input.body, engine: 'provider' });
                expect(result.detail).toMatchObject({ state: 'failed', providerCalled: true, result: null, provider: { attempts: [{ issue: 'PARSE_ERROR', remoteOutcomeUnknown: false, responseId: 'resp_real_envelope', requestId: 'req_real_envelope', usage: { inputTokens: 11, cacheWriteTokens: f.kind === 'output-object' ? 2 : null }, cost: { amountUsd: f.kind === 'output-object' ? 0.000465 : null } }] } });
                const outcomes = await repo.list('aiProviderOutcome');
                expect(outcomes).toHaveLength(1);
                expect(outcomes[0].data.rawCandidate).toBeNull();
                expect(outcomes[0].data.responseHash).toMatch(/^[a-f0-9]{64}$/);
                expect(JSON.stringify(outcomes)).not.toContain('PRIVATE_PROVIDER_BODY_NOT_TO_STORE');
                expect(await repo.list('aiAnalysisResult')).toHaveLength(0);
                expect(calls).toBe(1);
            }
            finally {
                (await repo.close());
                await rm(directory, { recursive: true, force: true });
            } });
    it('G17-V01 received lexical invalid JSON is PARSE_ERROR with no invented usage, not unreceived timeout', async () => { vi.stubGlobal('fetch', async () => new Response('{not-json', { headers: { 'content-type': 'application/json', 'x-request-id': 'req_lexical' } })); const r = await openaiTransport(config, request, async () => { }, async () => { }); expect(r).toMatchObject({ issue: 'PARSE_ERROR', remoteOutcomeUnknown: false, responseId: null, responseModel: null, usage: { inputTokens: null } }); expect(r.rawCandidate).toBeNull(); });
    it('G17-V01 actual SDK45s abort remains uncertain timeout with single fetch and no metadata', async () => { vi.useFakeTimers(); let calls = 0; vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => { calls++; return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('synthetic timeout', 'AbortError')), { once: true })); }); const pending = openaiTransport(config, request, async () => { }, async () => { }); await vi.advanceTimersByTimeAsync(45001); const r = await pending; expect(r).toMatchObject({ issue: 'TIMEOUT', remoteOutcomeUnknown: true, responseId: null, requestId: null, usage: { inputTokens: null } }); expect(calls).toBe(1); });
});
// Fake time advances the actual installed SDK deadline; only fetch I/O is synthetic.
// Every pending body is explicitly retired even on the failing pre-repair product.
async function bodyDeadlineProbe(boundary: 'transport' | 'sdk-control', headerDelay: number, bodyDelay: number | null) {
    vi.useFakeTimers();
    let calls = 0, before = 0, dispatched = 0, bodyRead = false, aborted = false;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
        calls++;
        if (headerDelay)
            await new Promise(resolve => setTimeout(resolve, headerDelay));
        const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; init.signal!.addEventListener('abort', () => { aborted = true; controller.error(new DOMException('synthetic body abort', 'AbortError')); }, { once: true }); }, pull() { bodyRead = true; } });
        if (bodyDelay !== null)
            setTimeout(() => { stream!.enqueue(new TextEncoder().encode(JSON.stringify(envelope([{ type: 'message', content: [{ type: 'output_text', text: '{"findings":[]}' }] }])))); stream!.close(); }, bodyDelay);
        return new Response(body, { headers: { 'content-type': 'application/json', 'x-request-id': 'req_body_deadline' } });
    });
    const value = boundary === 'transport' ? openaiTransport(config, request, async () => { before++; }, async () => { dispatched++; }) : new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0, timeout: 45000, logLevel: 'off' }).responses.create(request).withResponse().then(() => ({ issue: null })).catch(error => ({ issue: error instanceof OpenAI.APIConnectionTimeoutError ? 'TIMEOUT' : 'OTHER' }));
    let settled = false;
    void value.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(44999);
    const beforeDeadline = { settled, aborted };
    await vi.advanceTimersByTimeAsync(2);
    const atDeadline = { settled, aborted, calls, before, dispatched, bodyRead };
    if (!settled)
        stream!.error(new Error('bounded fixture cleanup after deadline observation'));
    const result = await value;
    return { beforeDeadline, atDeadline, result };
}
describe('G17-V02 SDK original deadline includes response body', () => {
    for (const boundary of ['transport', 'sdk-control'] as const)
        for (const delay of [0, 20000])
            it(`G17-V02 ${boundary} headers ${delay}ms then stalled body expires at original45s`, async () => {
                const p = await bodyDeadlineProbe(boundary, delay, null);
                expect(p.beforeDeadline).toEqual({ settled: false, aborted: false });
                expect(p.atDeadline).toMatchObject({ settled: true, aborted: true, calls: 1, bodyRead: true });
                expect(p.result.issue).toBe('TIMEOUT');
                if (boundary === 'transport') {
                    expect(p.atDeadline).toMatchObject({ before: 1, dispatched: 1 });
                    expect(p.result).toMatchObject({ remoteOutcomeUnknown: true, requestId: 'req_body_deadline', rawCandidate: null, responseId: null, usage: { inputTokens: null } });
                }
            });
    for (const boundary of ['transport', 'sdk-control'] as const)
        it(`G17-V02 ${boundary} headers20s and completed body10s succeeds within deadline`, async () => {
            const p = await bodyDeadlineProbe(boundary, 20000, 10000);
            expect(p.atDeadline).toMatchObject({ settled: true, aborted: false, calls: 1 });
            expect(p.result.issue).toBeNull();
            if (boundary === 'transport')
                expect(p.result).toMatchObject({ requestId: 'req_body_deadline', responseId: 'resp_real_envelope', remoteOutcomeUnknown: false, usage: { inputTokens: 11, cacheWriteTokens: 2 } });
        });
});
it('G17-V02 public SDK request preserves Responses.create wire options and single dispatch callbacks', async () => {
    const wire: unknown[] = [];
    const callbacks: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init: RequestInit) => { const headers = new Headers(init.headers); wire.push({ url: String(input), method: init.method, body: JSON.parse(String(init.body)), authMatches: headers.get('authorization') === `Bearer ${config.apiKey}`, contentType: headers.get('content-type'), accept: headers.get('accept'), retryCount: headers.get('x-stainless-retry-count'), timeout: headers.get('x-stainless-timeout') }); return response(envelope([{ type: 'message', content: [{ type: 'output_text', text: '{"findings":[]}' }] }])); });
    await new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0, timeout: 45000, logLevel: 'off' }).responses.create(request).withResponse();
    const result = await openaiTransport(config, request, async () => { callbacks.push('before'); }, async () => { callbacks.push('dispatched'); });
    expect(result.issue).toBeNull();
    expect(wire).toHaveLength(2);
    expect(wire[1]).toEqual(wire[0]);
    expect(wire[1]).toMatchObject({ url: 'https://api.openai.com/v1/responses', method: 'POST', authMatches: true, retryCount: '0', timeout: null, body: request });
    expect(callbacks).toEqual(['before', 'dispatched']);
});
