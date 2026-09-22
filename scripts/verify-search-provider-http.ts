/** Own synthetic HTTP/history proof. Always intercepted transport; never invokes live mode. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ProviderHarness, type ProviderClient, prepare, providerStart, content, ctx, sha } from './verify-ai-provider-support';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import type { AuditItem, AuditList } from '@/domain/audit/view';
import type { SearchDetail, SearchList } from '@/domain/search/types';
import type { AiReviewDetail } from '@/server/ai-review/contracts';
import type { AiInputDetail } from '@/server/ai-input/contracts';
import type { SubmissionWorkspace } from '@/server/submissions/contracts';
import type { UploadResult } from '@/server/submissions/files';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import { blankInternalPrice } from '@/domain/products/types';
const mode = process.env.G14_PROVIDER_MODE ?? 'sqlite';
assert(mode === 'mock' || mode === 'sqlite');
const root = path.resolve(process.env.G14_PROVIDER_ROOT ?? '.local/g14-provider-http');
mkdirSync(root, { recursive: true });
const report = path.resolve(process.env.G14_PROVIDER_REPORT ?? path.join(root, 'report.json'));
const h = new ProviderHarness(root, mode, Number(process.env.E2E_PORT ?? 4255));
const checks: {
    id: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    detail?: string;
}[] = [];
let failure: string | undefined;
const facts: Record<string, unknown> = {};
const planned = process.env.G14_PROVIDER_HISTORY_SOURCE ? ['P06-copy', 'P06-migration', 'P06-seed', 'P06-pid1', 'P06-pid2', 'P06-preserved'] : ['P01-settings', 'P01-replay', 'P02-success', 'P02-parse', 'P02-timeout', 'P02-retry', 'P02-catch', 'P03-price', 'P03-role', 'P03-revoke', 'P04-producer', 'P04-fault', 'P05-scalar', 'P05-usage', 'P05-relation', 'P05-extra', 'P02-read-only'];
function check(id: string, condition: unknown, detail?: string) { checks.push({ id, status: condition ? 'PASS' : 'FAIL', detail }); assert(condition, id); }
function skip(id: string, detail: string) { checks.push({ id, status: 'SKIP', detail }); }
const searchUrl = (extra: Record<string, string> = {}) => '/api/search?' + new URLSearchParams({ context: ctx, ...extra });
const auditUrl = (extra: Record<string, string> = {}) => '/api/audit?' + new URLSearchParams({ context: ctx, ...extra });
const exactUrl = (runId: string) => `/api/search/history?context=${ctx}&kind=aiAnalysisRun&id=${runId}`;
const auditExact = (id: string) => `/api/audit/${id}?context=${ctx}`;
const calls = () => existsSync(h.calls) ? readFileSync(h.calls, 'utf8').trim().split('\n').filter(Boolean).length : 0;
type Row = {
    kind: string;
    id: string;
    context_id: string | null;
    data: string;
    revision: number;
    created_at: string;
    updated_at: string;
};
function rows() { const db = openDatabase(h.database); try {
    return db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Row[];
}
finally {
    db.close();
} }
function injectStoredData(db: ReturnType<typeof openDatabase>, kind: string, id: string, data: string) {
    const triggerName = kind === 'audit' ? 'audit_no_update' : kind === 'aiProviderOutcome' ? 'immutable_ai_provider_update' : null;
    const trigger = triggerName ? db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name=?").get(triggerName) as {
        name: string;
        sql: string;
    } : null;
    db.transaction(() => {
        if (trigger) {
            assert.throws(() => db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(data, kind, id), /immutable/i);
            db.exec(`DROP TRIGGER ${trigger.name}`);
        }
        db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(data, kind, id);
        if (trigger)
            db.exec(trigger.sql);
    }).immediate();
    if (trigger)
        assert.equal((db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger.name) as {
            sql: string;
        }).sql, trigger.sql);
    const log = facts.storageFaultWrites as object[] | undefined ?? [];
    log.push({ kind, id, injectedDataHash: sha(data), guard: trigger?.name ?? null, guardSqlHash: trigger ? sha(trigger.sql) : null, method: 'own synthetic fixture only; native update rejection first; bypass and exact guard restoration in one exclusive transaction' });
    facts.storageFaultWrites = log;
}
function rawPatch(kind: string, id: string, patch: (data: Record<string, unknown>) => Record<string, unknown>) {
    const db = openDatabase(h.database);
    try {
        const row = db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(kind, id) as Row;
        assert(row);
        const data = JSON.stringify(patch(JSON.parse(row.data)));
        injectStoredData(db, kind, id, data);
        return { row, injected: data };
    }
    finally {
        db.close();
    }
}
function restore(row: Row) { const db = openDatabase(h.database); try {
    injectStoredData(db, row.kind, row.id, row.data);
}
finally {
    db.close();
} }
async function setStaff(admin: ProviderClient, status: 'active' | 'suspended') { const { members } = await admin.get<{
    members: {
        id: string;
        revision: number;
        data: {
            userId: string;
        };
    }[];
}>(`/api/contexts/${ctx}/members`), m = members.find(x => x.data.userId === 'user-gsg')!; await admin.ok(`/api/contexts/${ctx}/members/${m.id}`, { expectedRevision: m.revision, status }, 'PATCH'); }
async function clients() { const brand = h.client(), gsg = h.client(), admin = h.client(); await brand.login('luna@example.test'); await gsg.login(); await admin.login('admin@example.test'); return { brand, gsg, admin }; }
async function corruptResponse(c: ProviderClient, url: string, row: Row, injected: string) {
    try {
        const response = await c.send(url), body = await response.text();
        assert.equal(response.status, 503);
        assert(!body.includes('CORRUPT_CANARY'));
        assert.equal(rows().find(r => r.kind === row.kind && r.id === row.id)!.data, injected);
    }
    finally {
        restore(row);
    }
}
async function normal() {
    await h.setup();
    await h.start('fault');
    const { brand, gsg, admin } = await clients();
    const brandBefore = await brand.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }));
    for (const [expectedRevision, enabled] of [[0, false], [1, true]] as const) {
        const body = { contextId: ctx, expectedRevision, enabled, idempotencyKey: randomUUID() };
        await gsg.ok('/api/ai-review/settings', body);
        await gsg.ok('/api/ai-review/settings', body);
        assert.equal((await gsg.mutate('/api/ai-review/settings', { ...body, enabled: !enabled })).status, 409);
    }
    const settings = await gsg.get<AuditList>(auditUrl({ status: 'ai.provider.settings' }));
    check('P01-settings', settings.total === 2 && settings.items.every(x => x.sourcePrecision === 'record_only' && x.versions.length === 0 && x.target.url === null && x.changes[0].label === '외부 AI 사용') && new Set(settings.items.map(x => x.changes[0].before + x.changes[0].after)).size === 2);
    check('P01-replay', settings.items.every(x => x.receiptId && x.operationId === x.receiptId && x.correlation === 'recorded') && new Set(settings.items.map(x => x.receiptId)).size === 2);
    const f = await prepare(brand, gsg), successful = await providerStart(gsg, f);
    await providerStart(gsg, f);
    const successDetail = await gsg.get<SearchDetail>(exactUrl(successful.runId)), finished = await gsg.get<AuditList>(auditUrl({ status: 'ai.provider.finished' }));
    check('P02-success', calls() === 1 && (await gsg.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }))).items.some(x => x.sourceId === successful.runId) && successDetail.fields.some(x => x.value === '0.01395') && finished.items.some(x => x.target.id === successful.runId && x.receiptId === null && x.versions[0].id === successful.runId));
    h.fault({ mode: 'parse' });
    const malformed = await providerStart(gsg, await prepare(brand, gsg));
    check('P02-parse', malformed.detail.state === 'failed' && malformed.detail.result === null && (await gsg.get<SearchList>(searchUrl({ q: 'PARSE_ERROR' }))).items.some(x => x.sourceId === malformed.runId));
    h.fault({ mode: 'timeout' });
    const started = Date.now(), timed = await providerStart(gsg, await prepare(brand, gsg));
    check('P02-timeout', Date.now() - started >= 44000 && timed.detail.provider!.attempts[0].issue === 'TIMEOUT' && timed.detail.provider!.attempts[0].remoteOutcomeUnknown && (await gsg.get<SearchDetail>(exactUrl(timed.runId))).fields.some(x => x.label === '시도 1 · 입력 토큰' && x.value === '확인 불가'));
    const n = calls();
    assert.equal((await gsg.mutate(`/api/ai-review/runs/${timed.runId}/retry`, { expectedRevision: timed.detail.revision, idempotencyKey: randomUUID() })).status, 409);
    assert.equal(calls(), n);
    h.fault({ mode: 'success' });
    const retryBody = { expectedRevision: timed.detail.revision, acknowledgeUnknown: true, idempotencyKey: randomUUID() }, recovered = await gsg.ok<{
        detail: AiReviewDetail;
    }>(`/api/ai-review/runs/${timed.runId}/retry`, retryBody);
    await gsg.ok(`/api/ai-review/runs/${timed.runId}/retry`, retryBody);
    check('P02-retry', calls() === n + 1 && recovered.detail.provider!.attempts.length === 2 && recovered.detail.provider!.attempts[0].remoteOutcomeUnknown && (await gsg.get<SearchDetail>(exactUrl(timed.runId))).fields.some(x => x.label === '시도 2 · 입력 토큰' && x.value === '1000'));
    const caught = await providerStart(gsg, await prepare(brand, gsg, content('unregistered synthetic text'))), caughtEvents = await gsg.get<AuditList>(auditUrl({ status: 'ai.provider.finished' }));
    check('P02-catch', caught.detail.provider!.attempts[0].issue === 'EXTERNAL_USE_DENIED' && !caughtEvents.items.some(x => x.target.id === caught.runId) && (await gsg.get<SearchList>(searchUrl({ q: 'EXTERNAL_USE_DENIED' }))).items.some(x => x.sourceId === caught.runId) && calls() === n + 1);
    // Compare before adding an intentionally visible new product/author/status.
    const foreign = h.client();
    await foreign.login('wave@example.test');
    check('P03-role', JSON.stringify(await brand.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }))) === JSON.stringify(brandBefore) && (await brand.send(auditUrl())).status === 404 && (await foreign.send(searchUrl())).status === 404);
    const beforePrice = await gsg.get<AuditList>(auditUrl());
    const product = await admin.ok<{
        ids: string[];
    }>('/api/products', { contextId: ctx, brandId: 'brand-luna', common: { name: 'price-only-boundary', code: randomUUID() }, idempotencyKey: randomUUID() });
    const withProduct = await gsg.get<AuditList>(auditUrl());
    await admin.ok(`/api/products/${product.ids[0]}`, { contextId: ctx, command: 'save_internal', expectedPriceRevision: 0, price: { ...blankInternalPrice(), supplyAmount: '9234999', currency: 'JPY', source: 'PRIVATE_PROVIDER_PRICE_CANARY' }, idempotencyKey: randomUUID() });
    assert(beforePrice.total < withProduct.total);
    check('P03-price', JSON.stringify(await gsg.get<AuditList>(auditUrl())) === JSON.stringify(withProduct) && (await gsg.get<SearchList>(searchUrl({ q: 'PRIVATE_PROVIDER_PRICE_CANARY' }))).total === 0 && (await gsg.get<SearchList>(searchUrl({ q: '0.01395' }))).total > 0);
    await setStaff(admin, 'suspended');
    assert.equal((await gsg.send(searchUrl())).status, 404);
    assert.equal((await gsg.send(auditUrl())).status, 404);
    await setStaff(admin, 'active');
    check('P03-revoke', (await gsg.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }))).total > 0, 'Actual membership PATCH negative and restoration positive, distinct from invalid-scope P04 fault.');
    const request = { ...blankContent(), title: 'G14 prior PDF producer', description: '합성 원본', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('pdf', 'file'), label: 'PDF' }] };
    const tid = (await admin.ok<{
        ids: string[];
    }>('/api/tasks', { category: 'spot', content: request, targets: [{ contextId: ctx, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], idempotencyKey: randomUUID() })).ids[0];
    await admin.ok(`/api/tasks/${tid}`, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
    let workspace = await brand.get<SubmissionWorkspace>(`/api/tasks/${tid}/submissions`);
    const form = new FormData();
    form.append('clientItemIds', randomUUID());
    form.append('files', new Blob([readFileSync('tests/fixtures/ai-input/native-12.pdf')], { type: 'application/pdf' }), 'source.pdf');
    const uploadUrl = `/api/tasks/${tid}/submission-files?requestId=${workspace.request.id}`, csrf = await brand.get<{
        csrfToken: string;
    }>('/api/auth/csrf');
    const upload = await fetch(brand.origin + uploadUrl, { method: 'POST', headers: { Cookie: brand.cookie, Origin: brand.origin, 'X-CSRF-Token': csrf.csrfToken }, body: form });
    await h.capture(upload, 'POST', uploadUrl);
    assert.equal(upload.status, 200);
    const item = ((await upload.json()) as {
        items: UploadResult[];
    }).items[0];
    assert(item.state === 'ready');
    await brand.ok(`/api/tasks/${tid}/submission-draft`, { command: 'save', baseRequestId: workspace.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: workspace.request.id, requirementKey: 'pdf', productId: null, type: 'file', input: { fileVersionIds: [item.file.id] } }] }, idempotencyKey: randomUUID() });
    workspace = await brand.get(`/api/tasks/${tid}/submissions`);
    const sid = (await brand.ok<{
        ids: string[];
    }>(`/api/tasks/${tid}/submissions`, { baseRequestId: workspace.request.id, expectedDraftRevision: workspace.draft!.revision, expectedTaskRevision: workspace.taskRevision, mode: 'full', idempotencyKey: randomUUID() })).ids[0];
    const pdf = await prepare(brand, admin, { ...content(), kind: 'pdf', text: null, sources: [{ kind: 'submission_file', fileVersionId: item.file.id }], selectedPages: [2], submission: { taskId: tid, requestId: workspace.request.id, submissionId: sid, productUseIds: [] } });
    const past = await providerStart(admin, pdf);
    const latest = await brand.ok<AiInputDetail>(`/api/ai-input/${pdf.input.id}/versions`, { expectedRevision: pdf.input.revision, content: { ...content(), title: 'CURRENT_TEXT_AFTER_PDF' }, idempotencyKey: randomUUID() });
    const oldAudit = (await gsg.get<AuditList>(auditUrl({ status: 'ai.provider.finished' }))).items.find(x => x.target.id === past.runId)!;
    check('P04-producer', past.detail.state === 'finished' && latest.version.sequence === 2 && (await gsg.get<SearchDetail>(exactUrl(past.runId))).item.sourceId === past.runId && (await gsg.get<AuditItem>(auditExact(oldAudit.id))).versions[0].id === past.runId, 'Actual submitted PDF and independent new text version, both currently reauthorized.');
    if (mode === 'sqlite') {
        const fault = rawPatch('task', tid, d => ({ ...d, visibility: 'revoked_fixture' }));
        try {
            check('P04-fault', (await gsg.send(exactUrl(past.runId))).status === 404 && (await gsg.send(auditExact(oldAudit.id))).status === 404 && !(await gsg.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }))).items.some(x => x.sourceId === past.runId) && (await gsg.get<SearchList>(searchUrl({ q: 'CURRENT_TEXT_AFTER_PDF' }))).total === 1, 'Injected invalid-scope storage fault, NOT an actual per-file operational revocation.');
        }
        finally {
            restore(fault.row);
        }
        const settingsRow = settings.items[0].id;
        const known = rawPatch('audit', settingsRow, d => ({ ...d, after: { enabled: { value: 'CORRUPT_CANARY' } } }));
        await corruptResponse(gsg, auditExact(settingsRow), known.row, known.injected);
        check('P05-scalar', true);
        const outcome = rows().find(r => r.kind === 'aiProviderOutcome' && JSON.parse(r.data).runId === successful.runId)!;
        const badUsage = rawPatch('aiProviderOutcome', outcome.id, d => ({ ...d, usage: { ...(d.usage as object), inputTokens: { value: 'CORRUPT_CANARY' } } }));
        await corruptResponse(gsg, exactUrl(successful.runId), badUsage.row, badUsage.injected);
        check('P05-usage', true);
        const otherOutcome = rows().find(r => r.kind === 'aiProviderOutcome' && JSON.parse(r.data).runId === malformed.runId)!;
        const successEvent = finished.items.find(x => x.target.id === successful.runId)!;
        const cross = rawPatch('audit', successEvent.id, d => ({ ...d, after: { ...(d.after as object), outcomeId: otherOutcome.id } }));
        await corruptResponse(gsg, auditExact(successEvent.id), cross.row, cross.injected);
        const issue = rawPatch('audit', successEvent.id, d => ({ ...d, after: { ...(d.after as object), issue: { value: 'CORRUPT_CANARY' } } }));
        await corruptResponse(gsg, auditExact(successEvent.id), issue.row, issue.injected);
        check('P05-relation', true);
        const baseline = await gsg.get<AuditList>(auditUrl()), unknown = rawPatch('audit', successEvent.id, d => ({ ...d, unknown: { value: 'UNKNOWN_PROVIDER_CANARY' }, after: { ...(d.after as object), extra: { value: 'UNKNOWN_PROVIDER_CANARY' } } }));
        try {
            check('P05-extra', JSON.stringify(await gsg.get<AuditList>(auditUrl())) === JSON.stringify(baseline) && (await gsg.get<AuditList>(auditUrl({ q: 'UNKNOWN_PROVIDER_CANARY' }))).total === 0 && rows().find(r => r.kind === unknown.row.kind && r.id === unknown.row.id)!.data === unknown.injected);
        }
        finally {
            restore(unknown.row);
        }
    }
    else
        for (const id of ['P04-fault', 'P05-scalar', 'P05-usage', 'P05-relation', 'P05-extra'])
            skip(id, 'No raw mutation endpoint in process-local mock. Both-adapter unit fault seam/native persisted audit cases and SQLite real HTTP cover this boundary.');
    const beforeCalls = calls(), beforeRows = mode === 'sqlite' ? rows() : null;
    await gsg.get(searchUrl());
    await gsg.get(auditUrl());
    await gsg.get(exactUrl(past.runId));
    await gsg.get(auditExact(oldAudit.id));
    check('P02-read-only', calls() === beforeCalls && (!beforeRows || JSON.stringify(rows()) === JSON.stringify(beforeRows)), mode === 'sqlite' ? 'Every raw record unchanged across authenticated read GETs.' : 'Transport counter unchanged; both-adapter readonly UoW unit rejects any create/update.');
    facts.runs = { successful: successful.runId, malformed: malformed.runId, timed: timed.runId, caught: caught.runId, past: past.runId };
    facts.syntheticInterceptedCalls = calls();
}
function files(dir: string): string[] { return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : d.isFile() ? [path.join(dir, d.name)] : []) : []; }
async function historical() {
    assert.equal(mode, 'sqlite');
    const source = path.resolve(process.env.G14_PROVIDER_HISTORY_SOURCE!), original = path.join(source, 'data.db'), originals = [original, original + '-wal', original + '-shm', ...files(path.join(source, 'files'))].filter(existsSync);
    const hashes = originals.map(file => ({ path: file, sha256: sha(readFileSync(file)), bytes: readFileSync(file).length }));
    for (const suffix of ['', '-wal', '-shm'])
        if (existsSync(original + suffix))
            cpSync(original + suffix, h.database + suffix);
    if (existsSync(path.join(source, 'files')))
        cpSync(path.join(source, 'files'), h.files, { recursive: true });
    else
        mkdirSync(h.files);
    const copiedAt = new Date().toISOString(), firstOpenAt = new Date().toISOString(), db = openDatabase(h.database);
    const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Row[], ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
        name: string;
        sha256: string;
    }[];
    Object.assign(facts, { historicalSource: source, sourceOpened: false, copiedAt, firstOpenAt, originalHashes: hashes, originalRows: before.length, ledger });
    // The independently produced a0d G17 DB predates G13 integration: 0001..0013 +0015.
    // Accepted G17 integration may also contain0014; validate membership, not the highest number.
    const requiredPrior = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(4, '0')).concat('0015');
    check('P06-copy', copiedAt <= firstOpenAt && requiredPrior.every(n => ledger.some(r => r.name.startsWith(n + '-'))) && ledger.every(r => requiredPrior.includes(r.name.slice(0, 4)) || r.name.startsWith('0014-')) && before.some(r => r.kind === 'aiProviderOutcome'));
    const migration = migrate(db);
    check('P06-migration', migration.applied === 16 - ledger.length && migration.total === 16 && JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before) && JSON.stringify((db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
        name: string;
    }[]).filter(r => ledger.some(l => l.name === r.name))) === JSON.stringify(ledger));
    const repo = createSqliteRepository(db);
    await seed(repo);
    await seed(repo);
    check('P06-seed', JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before) && migrate(db).applied === 0);
    repo.close();
    const run = before.find(r => r.kind === 'aiAnalysisRun' && JSON.parse(r.data).engine === 'provider')!, event = before.find(r => r.kind === 'audit' && JSON.parse(r.data).action === 'ai.provider.finished' && JSON.parse(r.data).targetId === run.id)!;
    assert(run && event);
    assert(!JSON.parse(event.data).detail);
    writeFileSync(path.join(h.directory, 'original-rows.json'), JSON.stringify(before, null, 2));
    writeFileSync(path.join(h.directory, 'original-ledger.json'), JSON.stringify(ledger, null, 2));
    let prior = '';
    for (let round = 1; round <= 2; round++) {
        await h.start('fault');
        const gsg = h.client();
        await gsg.login();
        const exact = await gsg.get<SearchDetail>(exactUrl(run.id)), audit = await gsg.get<AuditItem>(auditExact(event.id)), list = await gsg.get<SearchList>(searchUrl({ q: 'gpt-6-astra' }));
        const serialized = JSON.stringify({ exact, audit, list });
        check(`P06-pid${round}`, exact.item.sourceId === run.id && exact.fields.some(f => f.label === '실행 모델' && f.value === 'gpt-6-astra') && audit.correlation === 'legacy_unavailable' && audit.receiptId === null && audit.operationId === null && audit.versions[0].id === run.id && (round === 1 || serialized === prior && h.processes[0].pid !== h.processes[1].pid));
        prior = serialized;
        await h.stop();
    }
    const after = rows(), business = before.filter(r => !['session', 'throttle'].includes(r.kind));
    check('P06-preserved', business.every(r => JSON.stringify(after.find(x => x.kind === r.kind && x.id === r.id)) === JSON.stringify(r)) && hashes.every(x => sha(readFileSync(x.path)) === x.sha256) && calls() === 0);
    Object.assign(facts, { historicalSource: source, sourceOpened: false, copiedAt, firstOpenAt, originalHashes: hashes, originalRows: before.length, preservedBusinessRows: business.length, excludedAuthKinds: ['session', 'throttle'], migration, ledger, actualProviderCalls: 0 });
}
try {
    if (process.env.G14_PROVIDER_HISTORY_SOURCE)
        await historical();
    else
        await normal();
}
catch (error) {
    failure = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
}
finally {
    await h.stopAll();
    writeFileSync(report, JSON.stringify({ candidate_commit: h.candidate, cwd: process.cwd(), session_id: '01a0c307-9b54-7b83-b5eb-1b12b9a8553c', mode, checks, counts: { pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, skip: checks.filter(c => c.status === 'SKIP').length, unit: 'bounded grouped assertion' }, notRun: planned.filter(id => !checks.some(c => c.id === id)), failure, facts, directory: h.directory, processes: h.processes, transcript: h.transcript, faultLoader: h.loader, actualOpenAICalls: 0, actualEnvReads: 0, sourceOpened: false }, null, 2));
    console.log(JSON.stringify({ report, counts: { pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, skip: checks.filter(c => c.status === 'SKIP').length }, failure }));
}
