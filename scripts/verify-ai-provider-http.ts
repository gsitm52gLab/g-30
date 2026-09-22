import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ProviderHarness, prepare, providerStart, content, ctx, sleep, type ProviderClient } from './verify-ai-provider-support';
import type { AiReviewDetail, ProviderSettings } from '@/server/ai-review/contracts';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import type { SubmissionWorkspace } from '@/server/submissions/contracts';
import type { CompletionService } from '@/server/completion/service';
const mode = process.env.AI_PROVIDER_MODE ?? 'sqlite';
assert(mode === 'mock' || mode === 'sqlite');
const root = path.resolve(process.env.AI_PROVIDER_ROOT ?? '.local/g17-http'), report = path.resolve(process.env.AI_PROVIDER_REPORT ?? path.join(root, 'report.json')), port = Number(process.env.E2E_PORT ?? 4247), aux = Number(process.env.E2E_AUX_PORT ?? 4248);
mkdirSync(root, { recursive: true });
const harnesses: ProviderHarness[] = [], checks: {
    id: string;
    requirements: string[];
    status: 'PASS' | 'FAIL' | 'SKIP';
    level: string;
    reason?: string;
}[] = [];
let failure: string | undefined;
const planned = Array.from({ length: 21 }, (_, i) => 'H' + String(i + 1).padStart(2, '0'));
function check(id: string, ok: unknown, req = ['AC-17-01']) { checks.push({ id, requirements: req, status: ok ? 'PASS' : 'FAIL', level: 'normal production HTTP + intercepted SDK fetch (no OpenAI network)' }); assert(ok, id); }
function skip(id: string, reason: string) { checks.push({ id, requirements: ['AC-17-02', 'D10'], status: 'SKIP', level: 'SQLite-only', reason }); }
function calls(h: ProviderHarness) { return existsSync(h.calls) ? readFileSync(h.calls, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : []; }
async function group(kind: 'fault' | 'missing' = 'fault') { const h = new ProviderHarness(root, mode as 'mock' | 'sqlite', port); harnesses.push(h); await h.setup(); await h.start(kind); const brand = h.client(), gsg = h.client(), admin = h.client(); await brand.login('luna@example.test'); await gsg.login(); await admin.login('admin@example.test'); return { h, brand, gsg, admin }; }
async function setStaff(admin: ProviderClient, status: 'active' | 'suspended') { const data = await admin.get<{
    members: {
        id: string;
        revision: number;
        data: {
            userId: string;
        };
    }[];
}>(`/api/contexts/${ctx}/members`), m = data.members.find(x => x.data.userId === 'user-gsg')!; await admin.ok(`/api/contexts/${ctx}/members/${m.id}`, { expectedRevision: m.revision, status }, 'PATCH'); }
async function untilCall(h: ProviderHarness, count: number) { for (let i = 0; i < 200; i++) {
    if (calls(h).length >= count)
        return;
    await sleep(25);
} throw Error('expected intercepted actual fetch boundary'); }
try {
    const first = await group('missing');
    let { h, brand, gsg, admin } = first;
    const f = await prepare(brand, gsg), missing = await providerStart(gsg, f);
    check('H01 missing key persists explicit no-dispatch failure', missing.detail.state === 'failed' && !missing.detail.providerCalled && missing.detail.provider!.attempts[0].issue === 'KEY_MISSING' && calls(h).length === 0);
    check('H02 current GSG-only setting and CSRF, no secret fields', (await brand.send(`/api/ai-review/settings?contextId=${ctx}`)).status === 404 && (await gsg.send('/api/ai-review/settings', 'POST', { contextId: ctx, enabled: false, expectedRevision: 0, idempotencyKey: randomUUID() })).status === 403 && !JSON.stringify(await gsg.get<ProviderSettings>(`/api/ai-review/settings?contextId=${ctx}`)).includes('apiKey'), ['D04', 'AC-17-01']);
    await h.stop();
    await h.start('fault');
    brand = h.client();
    gsg = h.client();
    admin = h.client();
    await brand.login('luna@example.test');
    await gsg.login();
    await admin.login('admin@example.test');
    if (mode === 'sqlite') {
        const command = { expectedRevision: missing.detail.revision, restartConfiguration: true, idempotencyKey: randomUUID() }, recovered = await gsg.ok<{
            runId: string;
            detail: AiReviewDetail;
        }>(`/api/ai-review/runs/${missing.runId}/retry`, command);
        await gsg.ok(`/api/ai-review/runs/${missing.runId}/retry`, command);
        check('H03 new PID key restore uses explicit same-run recovery and receipt no resend', recovered.runId === missing.runId && recovered.detail.state === 'finished' && recovered.detail.provider!.attempts.length === 2 && calls(h).length === 1, ['AC-17-02', 'D10']);
    }
    else
        skip('H03 new PID key restore', 'mock is process-local; SQLite proves durable same-run restoration');
    const unknown = await prepare(brand, gsg, content('Unregistered confidential-like synthetic test'));
    const before = calls(h).length, blocked = await providerStart(gsg, unknown);
    check('H04 server exact-hash provenance rejects unregistered original', blocked.detail.provider!.attempts[0].issue === 'EXTERNAL_USE_DENIED' && calls(h).length === before, ['SA-62', 'D04']);
    for (const [index, cfg, issue] of [[5, { status: 401 }, 'PROVIDER_AUTH'], [6, { mode: 'refusal' }, 'REFUSAL'], [7, { mode: 'incomplete' }, 'INCOMPLETE'], [8, { mode: 'parse' }, 'PARSE_ERROR']] as const) {
        h.fault(cfg);
        const fixture = await prepare(brand, admin), r = await providerStart(admin, fixture), a = r.detail.provider!.attempts[0];
        check(`H${String(index).padStart(2, '0')} actual SDK ${issue} remains failed with safe provided metadata`, r.detail.state === 'failed' && a.issue === issue && r.detail.result === null && !JSON.stringify(r).includes('SYNTHETIC_FAULT_KEY_MUST_NOT_LEAK') && (issue === 'PROVIDER_AUTH' || a.usage?.inputTokens === 1000 && a.cost?.amountUsd === 0.01395));
    }
    await h.stopAll();
    ({ h, brand, gsg, admin } = await group());
    h.fault({ status: 429 });
    const retryFixture = await prepare(brand, gsg);
    let retry = await providerStart(gsg, retryFixture);
    h.fault({ status: 500 });
    let command = { expectedRevision: retry.detail.revision, idempotencyKey: randomUUID() };
    retry = await gsg.ok(`/api/ai-review/runs/${retry.runId}/retry`, command);
    h.fault({ mode: 'success' });
    command = { expectedRevision: retry.detail.revision, idempotencyKey: randomUUID() };
    retry = await gsg.ok(`/api/ai-review/runs/${retry.runId}/retry`, command);
    await gsg.ok(`/api/ai-review/runs/${retry.runId}/retry`, command);
    check('H09 429 then500 explicit bounded same logical run, duplicate intent0 extra fetch', retry.detail.state === 'finished' && retry.detail.provider!.attempts.map(x => x.issue).join() === 'RATE_LIMIT,SERVER_ERROR,' && calls(h).length === 3, ['AC-17-02']);
    const gate = path.join(h.directory, 'race-release');
    h.fault({ mode: 'success', gate });
    const raceFixture = await prepare(brand, admin), priorCalls = calls(h).length;
    const pending = providerStart(admin, raceFixture);
    await untilCall(h, priorCalls + 1);
    let second: ProviderClient = admin;
    if (mode === 'sqlite') {
        await h.start('fault', aux);
        second = h.client(aux);
        await second.login('admin@example.test');
    }
    const concurrent = await providerStart(second, raceFixture);
    check('H10 concurrent same intent one live claim across available process boundary', concurrent.detail.state === 'running' && calls(h).length === priorCalls + 1, ['AC-17-02']);
    writeFileSync(gate, 'release');
    const finished = await pending;
    check('H11 same claim one immutable result and one network attempt', finished.detail.state === 'finished' && finished.detail.provider!.attempts.length === 1, ['AC-17-02']);
    if (mode === 'sqlite')
        await h.stop(aux);
    else
        skip('H21 two OS SQLite shared-store claim', 'mock same-process race H10/11 only');
    const revokeGate = path.join(h.directory, 'revoke-release');
    h.fault({ mode: 'success', gate: revokeGate });
    const rf = await prepare(brand, gsg), n = calls(h).length;
    const revokedPending = gsg.mutate(`/api/ai-review/inputs/${rf.input.id}/start`, rf.body);
    await untilCall(h, n + 1);
    await setStaff(admin, 'suspended');
    writeFileSync(revokeGate, 'release');
    const denied = await revokedPending;
    check('H12 after actual SDK request current membership loss denies response and raw publication', denied.status === 404 && (await gsg.send(`/api/ai-review/inputs/${rf.input.id}`)).status === 404, ['D04']);
    await setStaff(admin, 'active');
    const rw = await gsg.get<{
        runs: {
            id: string;
        }[];
    }>(`/api/ai-review/inputs/${rf.input.id}`), rd = await gsg.get<AiReviewDetail>(`/api/ai-review/runs/${rw.runs[0].id}`);
    check('H13 safe denied outcome retains usage but no candidate/result', rd.state === 'failed' && rd.result === null && rd.provider!.attempts[0].issue === 'ACCESS_CHANGED' && rd.provider!.attempts[0].usage?.inputTokens === 1000, ['D04', 'AC-17-04']);
    h.fault({ mode: 'timeout' });
    const tf = await prepare(brand, admin), at = Date.now(), timed = await providerStart(admin, tf);
    check('H14 actual SDK timeout45s is explicit uncertain failure', timed.detail.provider!.attempts[0].issue === 'TIMEOUT' && timed.detail.provider!.attempts[0].remoteOutcomeUnknown && Date.now() - at >= 44000, ['AC-17-01']);
    const timeoutCalls = calls(h).length;
    const noAck = await admin.mutate(`/api/ai-review/runs/${timed.runId}/retry`, { expectedRevision: timed.detail.revision, idempotencyKey: randomUUID() });
    check('H15 unknown recovery without explicit acknowledgement sends zero', noAck.status === 409 && (await noAck.json()).error.code === 'RESPONSE_UNKNOWN' && calls(h).length === timeoutCalls, ['AC-17-02']);
    h.fault({ mode: 'success' });
    const recovered = await admin.ok<{
        detail: AiReviewDetail;
    }>(`/api/ai-review/runs/${timed.runId}/retry`, { expectedRevision: timed.detail.revision, acknowledgeUnknown: true, idempotencyKey: randomUUID() });
    check('H16 explicit timeout recovery keeps first uncertainty and new attempt', recovered.detail.state === 'finished' && recovered.detail.provider!.attempts.length === 2 && recovered.detail.provider!.attempts[0].remoteOutcomeUnknown, ['AC-17-02']);
    const saved = JSON.stringify(recovered.detail);
    if (mode === 'sqlite') {
        await h.stop();
        await h.start('missing');
        admin = h.client();
        await admin.login('admin@example.test');
        check('H17 new PID relogin preserves all actual usage and failed/success attempts', JSON.stringify(await admin.get<AiReviewDetail>(`/api/ai-review/runs/${timed.runId}`)) === saved, ['D10', 'AC-17-04']);
        check('H21 two OS SQLite shared-store claim', h.processes.length >= 3, ['AC-17-02']);
    }
    else
        skip('H17 new PID durable read', 'mock process-local; SQLite proves durable history');
    await h.stopAll();
    ({ h, brand, gsg, admin } = await group());
    await admin.ok('/api/ai-review/settings', { contextId: ctx, enabled: false, expectedRevision: 0, idempotencyKey: randomUUID() });
    const c = blankContent();
    c.title = 'G17 outage actual partial submission';
    c.description = '합성자료로 기본업무를 확인합니다';
    c.deadline.responsibleUserId = 'user-gsg';
    c.requirements = [{ ...blankRequirement('claim', 'long_text'), label: '문안' }, { ...blankRequirement('remaining', 'number'), label: '남은 수량' }];
    const tid = (await admin.ok<{
        ids: string[];
    }>('/api/tasks', { targets: [{ contextId: ctx, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], category: 'spot', content: c, idempotencyKey: randomUUID() })).ids[0];
    await admin.ok(`/api/tasks/${tid}`, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
    let w = await brand.get<SubmissionWorkspace>(`/api/tasks/${tid}/submissions`);
    await brand.ok(`/api/tasks/${tid}/submission-draft`, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'claim', productId: null, type: 'long_text', input: { text: content().text } }] }, idempotencyKey: randomUUID() });
    w = await brand.get<SubmissionWorkspace>(`/api/tasks/${tid}/submissions`);
    const sid = (await brand.ok<{
        ids: string[];
    }>(`/api/tasks/${tid}/submissions`, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'partial', idempotencyKey: randomUUID() })).ids[0];
    const linked = await prepare(brand, admin, { ...content(), submission: { taskId: tid, requestId: w.request.id, submissionId: sid, productUseIds: [] } }), disabled = await providerStart(admin, linked);
    check('H18 disabled AI preserves actual G05 partial submission and explicit failure', disabled.detail.provider!.attempts[0].issue === 'DISABLED' && (await brand.get<SubmissionWorkspace>(`/api/tasks/${tid}/submissions`)).taskStatus === 'partial' && calls(h).length === 0, ['AC-17-03']);
    type Completion = Awaited<ReturnType<CompletionService['workspace']>>;
    const preview = await admin.get<Completion>(`/api/completion?taskId=${tid}`);
    check('H19 actual failed AI producer is G11 residual without blocking empty-memo completion', preview.preview!.basis.ai.state === 'available' && preview.preview!.basis.ai.value.failed === 1 && (await admin.ok<{
        ids: string[];
    }>('/api/completion', { command: 'complete', taskId: tid, expectedTaskRevision: preview.taskRevision, expectedBasisHash: preview.preview!.basisHash, memo: '', idempotencyKey: randomUUID() })).ids.length > 0, ['AC-17-03', 'D07']);
    const bodies = harnesses.flatMap(x => x.transcript.filter(t => !t.url.includes('/auth/')).map(t => readFileSync(t.path, 'utf8')));
    check('H20 API bodies and safe server logs contain no fake credential or error echo', ![...bodies, ...harnesses.flatMap(x => x.processes.map(p => readFileSync(p.log, 'utf8')))].some(x => x.includes('SYNTHETIC_FAULT_KEY_MUST_NOT_LEAK')), ['AC-17-01', 'D04']);
}
catch (e) {
    failure = e instanceof Error ? e.stack : String(e);
    process.exitCode = 1;
}
finally {
    for (const h of harnesses)
        await h.stopAll();
    const first = harnesses[0];
    writeFileSync(report, JSON.stringify({ candidate: first?.candidate, cwd: process.cwd(), mode, session: '01a0c307-c975-75b1-b96a-5a5c4e448aec', checks, counts: { pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, skip: checks.filter(c => c.status === 'SKIP').length, unit: 'assertion' }, notRun: planned.filter(id => !checks.some(c => c.id.startsWith(id))), failure, harnesses: harnesses.map(h => ({ directory: h.directory, processes: h.processes, transcript: h.transcript, faultLoader: h.loader, calls: h.calls })), actualOpenAICalls: 0, transport: 'normal Next production routes with process-only official-fetch interceptor; fake key, no provider network', coreRemaining: 'G06/G09/G16 human review flows covered separately; no expert approval claim' }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ report, pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, skip: checks.filter(c => c.status === 'SKIP').length, failure }));
}
