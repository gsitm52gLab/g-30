import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { migrate, openDatabase } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { createMockRepository } from "@/server/repositories/mock";
import type { RecordRepository } from "@/domain/records";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import type { TaskDetail } from "@/server/tasks/service";
import { completionFixture, type CompletionFixtureInput, type CompletionFixtureSnapshot } from "./verify-completion-fixtures";
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
if (process.argv.includes("--mock-server")) {
    const repo = createMockRepository();
    await seed(repo);
    (globalThis as typeof globalThis & {
        gsHaleRepository?: {
            key: string;
            pending: Promise<RecordRepository>;
        };
    }).gsHaleRepository = { key: `mock:${process.env.DATABASE_FILE}`, pending: Promise.resolve(repo) };
    process.on("message", async (message) => {
        const m = message as {
            id: string;
            input: CompletionFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await completionFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.COMPLETION_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("COMPLETION_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4229), auxPort = validPort(process.env.E2E_AUX_PORT, 4230);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.COMPLETION_HTTP_ROOT ?? ".local/g11-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "completion.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.COMPLETION_HTTP_REPORT ?? path.join(directory, "report.json"));
mkdirSync(path.dirname(reportFile), { recursive: true });
const candidate = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), startedAt = new Date().toISOString();
const processes: {
    port: number;
    pid?: number;
    args: string[];
    cwd: string;
    log: string;
    exitCode?: number | null;
    signal?: string | null;
    stopped?: boolean;
}[] = [];
const checks: {
    id: string;
    requirements: string[];
    level: "HTTP" | "DB_FIXTURE" | "PROCESS";
    status: "PASS" | "FAIL";
}[] = [];
const transcript: {
    method: string;
    path: string;
    status: number;
    responseSha256?: string;
    artifact?: string;
    bytes?: number;
}[] = [];
const children = new Map<number, ChildProcess>();
async function capture(response: Response, method: string, url: string) {
    const bytes = Buffer.from(await response.clone().arrayBuffer());
    const artifact = `${reportFile}.responses/${String(transcript.length + 1).padStart(4, '0')}.body`;
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, bytes, { mode: 0o600 });
    transcript.push({ method, path: url, status: response.status, artifact, bytes: bytes.length, responseSha256: createHash('sha256').update(bytes).digest('hex') });
}
let failure: string | undefined;
function check(id: string, condition: unknown, requirements = ["AC-11-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-completion-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g11_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
    children.set(p, child);
    const record = { port: p, pid: child.pid, args: [process.execPath, ...args], cwd: process.cwd(), log };
    processes.push(record);
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    child.once("exit", () => output.end());
    for (let n = 0; n < 200; n++) {
        if (child.exitCode !== null)
            throw new Error(`Owned server ${p} exited`);
        try {
            if ((await fetch(`${origin}/api/health`)).status === 200)
                return;
        }
        catch { }
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error("Owned product server readiness timeout");
}
async function stop(p: number) {
    const child = children.get(p);
    if (!child)
        return;
    const done = new Promise<void>(resolve => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null)
        await done;
    const record = processes.findLast(r => r.pid === child.pid)!;
    record.exitCode = child.exitCode;
    record.signal = child.signalCode;
    record.stopped = true;
    children.delete(p);
}
async function fixture<T>(input: CompletionFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await completionFixture(repo, input) as T;
        }
        finally {
            repo.close();
        }
    }
    const child = children.get(port)!;
    return new Promise<T>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => reject(new Error("private fixture IPC timeout")), 5000);
        const listener = (message: unknown) => {
            const m = message as {
                id: string;
                value: T;
                error?: string;
            };
            if (m.id !== id)
                return;
            clearTimeout(timer);
            child.off("message", listener);
            if (m.error)
                reject(new Error(m.error));
            else
                resolve(m.value);
        };
        child.on("message", listener);
        child.send({ id, input });
    });
}
class Client {
    cookie = "";
    constructor(public slot = port) { }
    get origin() { return `http://127.0.0.1:${this.slot}`; }
    get token() { return this.cookie.slice(this.cookie.indexOf("=") + 1); }
    async send(url: string, method = "GET", body?: unknown, csrf?: string) {
        const response = await fetch(this.origin + url, { method, redirect: "manual", headers: { Cookie: this.cookie, ...method !== "GET" ? { "Content-Type": "application/json", Origin: this.origin, "X-CSRF-Token": csrf ?? "" } : {} }, body: body === undefined ? undefined : JSON.stringify(body) });
        const cookie = response.headers.get("set-cookie");
        if (cookie)
            this.cookie = cookie.split(";")[0];
        await capture(response, method, url);
        return response;
    }
    async get<T>(url: string): Promise<T> { const response = await this.send(url); assert.equal(response.status, 200, `GET ${url}`); const body = await response.text(); return JSON.parse(body) as T; }
    async mutate(url: string, body: unknown, method = "POST") {
        const csrf = await this.get<{
            csrfToken: string;
        }>("/api/auth/csrf");
        return this.send(url, method, body, csrf.csrfToken);
    }
    async login(email: string) { const response = await this.mutate("/api/auth/login", { email, password: DEMO_PASSWORD }); assert.equal(response.status, 200, "synthetic actual login"); }
    async upload(query: string, bytes: Buffer, name = "synthetic.png", mime = "image/png", visibility = "public", count = 1) {
        const csrf = await this.get<{
            csrfToken: string;
        }>("/api/auth/csrf"), body = new FormData();
        for (let n = 0; n < count; n++)
            body.append("files", new Blob([new Uint8Array(bytes)], { type: mime }), name);
        body.append("visibility", visibility);
        const response = await fetch(`${this.origin}/api/files?${query}`, { method: "POST", headers: { Cookie: this.cookie, Origin: this.origin, "X-CSRF-Token": csrf.csrfToken }, body });
        await capture(response, "POST multipart", `/api/files?${query}`);
        return response;
    }
}
import type { CompletionWorkspace, CompletionSnapshot, ExternalAction } from '@/server/completion/service';
import type { ExternalActionInput } from '@/domain/completion/types';
import type { SubmissionWorkspace, SubmissionSnapshot, UploadResult } from '@/server/submissions/contracts';
import type { ProductDetail } from '@/server/products/service';
import type { ReviewTarget } from '@/domain/corrections/types';
import type { ConversationDetailDTO as InquiryDetail } from '@/server/inquiries/contracts';
import { blankDraft } from '@/domain/submissions/types';
const A = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), team = new Client(), foreign = new Client();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const byteHash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let taskId = '', reachedEnd = false;
const workspace = (c = admin, id = taskId) => c.get<CompletionWorkspace>(`/api/completion?taskId=${id}`);
const snapshot = (id: string, c = admin) => c.get<CompletionSnapshot>(`/api/completion/${id}`);
function persist(name: string, value: unknown) { writeFileSync(`${reportFile}.${name}.json`, JSON.stringify(value, null, 2), { mode: 0o600 }); }
async function post(c: Client, url: string, body: unknown, status = 200) { const r = await c.mutate(url, body); assert.equal(r.status, status, await r.clone().text()); return r.json(); }
async function cmd(c: Client, body: Record<string, unknown>) { return (await post(c, '/api/completion', { taskId, idempotencyKey: randomUUID(), ...body })).ids as string[]; }
async function completeInput(id = taskId) { const w = await workspace(admin, id); return { command: 'complete', taskId: id, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() }; }
async function makeTask(title: string) {
    const content = { ...blankContent(), title, description: 'Actual completion source', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: 'Answer' }, { ...blankRequirement('missing', 'short_text'), label: 'Still missing' }] };
    const created = await post(admin, '/api/tasks', { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: ['product-serum'] }], content, category: 'spot', idempotencyKey: randomUUID() }, 201), id = created.ids[0] as string;
    const t = await admin.get<TaskDetail>(`/api/tasks/${id}`);
    await post(admin, `/api/tasks/${id}`, { command: 'publish', expectedRevision: t.task.revision, idempotencyKey: randomUUID() });
    return id;
}
async function actualSubmission(label: string): Promise<ReviewTarget> {
    let w = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    const csrf = await brand.get<{
        csrfToken: string;
    }>('/api/auth/csrf'), body = new FormData();
    body.append('files', new Blob([new Uint8Array(png)], { type: 'image/png' }), label + '.png');
    body.append('clientItemIds', randomUUID());
    const url = `/api/tasks/${taskId}/submission-files?requestId=${w.request.id}`, uploaded = await fetch(brand.origin + url, { method: 'POST', headers: { Cookie: brand.cookie, Origin: brand.origin, 'X-CSRF-Token': csrf.csrfToken }, body });
    await capture(uploaded, 'POST multipart', url);
    assert.equal(uploaded.status, 200);
    const item = (await uploaded.json() as {
        items: UploadResult[];
    }).items[0];
    assert.equal(item.state, 'ready');
    if (item.state !== 'ready')
        throw Error('actual upload failed');
    const p = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`), content = { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: label } }], artifacts: [{ fileVersionId: item.file.id, role: 'review_copy', answer: null }], productSelections: [{ productId: p.productId, expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }] };
    await post(brand, `/api/tasks/${taskId}/submission-draft`, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft?.revision ?? 0, content, idempotencyKey: randomUUID() });
    w = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    const submitted = await post(brand, `/api/tasks/${taskId}/submissions`, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'partial', idempotencyKey: randomUUID() }, 201), id = submitted.ids[0] as string, s = await brand.get<SubmissionSnapshot>(`/api/submissions/${id}`);
    return { taskId, submissionId: id, requestId: s.requestId, submissionContentHash: s.contentHash, answer: null, fileVersionIds: [item.file.id], productUseIds: s.products.map(p => p.id), location: { page: '1', locator: 'lower' } };
}
async function actualInquiry(c = brand, text = 'G11_OWN_PUBLIC_QUESTION') {
    const d = await post(c, '/api/inquiries', { contextId: A, taskId, idempotencyKey: randomUUID() }, 201);
    await post(c, `/api/inquiries/${d.conversationId}`, { command: 'publish_first', expectedRevision: d.revision, title: 'Actual question', content: { clientMessageId: randomUUID(), body: text, fileVersionIds: [] }, idempotencyKey: randomUUID() });
    const v = await admin.get<InquiryDetail>(`/api/inquiries/${d.conversationId}`);
    if (v.phase !== 'active')
        throw Error('active inquiry');
    const q = v.questions[0];
    await post(admin, `/api/inquiries/${d.conversationId}`, { command: 'state', questionId: q.id, expectedQuestionRevision: q.revision, state: 'external_waiting', reason: 'External confirmation', externalWait: { counterparty: 'Synthetic agency', sentAt: '2026-09-21T15:30:00+09:00', responsibleUserId: 'user-gsg', nextCheckDate: '2026-10-05', timezone: 'Asia/Tokyo', latestResult: 'Actual waiting' }, idempotencyKey: randomUUID() });
    return { conversationId: v.id, questionId: q.id };
}
async function actualCorrection(target: ReviewTarget) {
    const opinion = (await post(admin, '/api/corrections', { command: 'save_opinion', taskId, opinionId: null, expectedRevision: 0, opinion: { target, source: { kind: 'external_opinion', agency: 'Synthetic agency', reviewer: 'Reviewer', source: 'G11_PRIVATE_SOURCE' }, originalText: 'G11_PRIVATE_ORIGINAL', internalFileVersionIds: [], receivedOn: '2026-09-21', conflictingOpinionVersionIds: [] }, idempotencyKey: randomUUID() })).ids[1];
    const draftId = (await post(admin, '/api/corrections', { command: 'save_draft', taskId, draftId: null, expectedRevision: 0, draft: { title: 'Actual public batch', summary: 'Unresolved correction', items: [{ key: 'change', target, internalOpinionVersionIds: [opinion], publicSource: 'Public source', change: 'Change expression', reason: 'Check specification', publicDescription: 'G11_PUBLIC_CORRECTION', priority: 'normal', issue: 'correction' }], mode: 'urgent_partial', pendingScopes: [{ agency: 'Later agency', scope: 'More opinion', expectedOn: null }], previousBatchVersionId: null }, idempotencyKey: randomUUID() })).ids[0];
    return (await post(admin, '/api/corrections', { command: 'publish', taskId, draftId, expectedRevision: 1, idempotencyKey: randomUUID() })).ids[0];
}
const sourceFacts=(x:ExternalAction)=>({requestId:x.source.requestId,submissionId:x.source.submissionId,submissionContentHash:x.source.submissionContentHash,fileVersionIds:x.source.fileVersionIds,productUseIds:x.source.productUseIds,files:x.source.files.map(f=>({id:f.id,bytes:f.bytes,sha256:f.sha256})),products:x.source.products.map(p=>({id:p.id,contentHash:p.contentHash,productVersionId:p.productVersionId,contextProductVersionId:p.contextProductVersionId}))});
function action(target: ReviewTarget): ExternalActionInput { return { purpose: 'review_request', destination: 'Synthetic outside agency', requester: { kind: 'user', userId: 'user-luna' }, performer: { kind: 'external', label: 'Actual outside performer', source: 'Synthetic observed message' }, source: { requestId: target.requestId, submissionId: target.submissionId, submissionContentHash: target.submissionContentHash, fileVersionIds: target.fileVersionIds, productUseIds: target.productUseIds }, observedAt: { value: '2026-09-21', precision: 'date', timezone: 'Asia/Tokyo', source: 'Observed message' }, evidenceFileVersionIds: [], latestProgress: 'Waiting factual response', waitingExternal: true, visibility: 'public' }; }
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    check('G11-H01 anonymous and invalid CSRF denied', (await new Client().send('/api/completion?taskId=task-onboarding')).status === 401 && (await admin.send('/api/completion', 'POST', {})).status === 403, ['A19']);
    await admin.login('admin@example.test');
    await brand.login('luna@example.test');
    await team.login('team@example.test');
    await foreign.login('wave@example.test');
    check('G11-H02 unknown input and duplicate scope rejected', (await admin.mutate('/api/completion', { command: 'automatic_approval' })).status === 422 && (await admin.send('/api/completion?taskId=a&taskId=b')).status === 422, ['A19']);
    taskId = await makeTask('G11 actual manual completion');
    const target = await actualSubmission('Actual partial v1');
    await actualInquiry();
    const q = await actualInquiry(team, 'G11_OTHER_PRIVATE_QUESTION'), batchId = await actualCorrection(target);
    const w = await workspace();
    const basis = w.preview!.basis;
    persist('actual-producer-preview', w);
    check('G11-H03 actual G05 partial and exact ProductUse current request sources', basis.currentEvaluation.state === 'available' && basis.currentEvaluation.value.missing === 1 && basis.latestSubmission?.id === target.submissionId && basis.latestSubmission.products.state === 'available' && basis.latestSubmission.products.value[0].id === target.productUseIds[0], ['AC-11-01', 'AC-11-02', 'D01']);
    check('G11-H04 actual G09 external wait and G10 unresolved scope without future fake zero', basis.inquiries.state === 'available' && basis.inquiries.value.unresolved === 2 && basis.inquiries.value.externalWaiting === 2 && basis.corrections.state === 'available' && basis.corrections.value.unresolved === 1 && basis.corrections.value.pendingScopes[0].batchVersionId === batchId && basis.ai.connected === false && basis.ai.value === null && basis.campaign.connected === false, ['AC-11-01', 'AC-11-02']);
    const before = await fixture<CompletionFixtureSnapshot>({ taskId });
    await workspace();
    check('G11-H05 preview does not write cursor audit or receipts', (await fixture<CompletionFixtureSnapshot>({ taskId })).rowsSha256 === before.rowsSha256, ['A20'], 'DB_FIXTURE');
    check('G11-H06 brand team and foreign cannot complete; AI anonymous denied', (await brand.mutate('/api/completion', await completeInput())).status === 403 && (await team.mutate('/api/completion', await completeInput())).status === 403 && (await foreign.send(`/api/completion?taskId=${taskId}`)).status === 404 && (await new Client().send('/api/completion?taskId=' + taskId)).status === 401, ['AC-11-02', 'A19']);
    const stale = await completeInput(), qd = await admin.get<InquiryDetail>(`/api/inquiries/${q.conversationId}`);
    if (qd.phase !== 'active')
        throw Error('active inquiry');
    await post(admin, `/api/inquiries/${q.conversationId}`, { command: 'answer', questionId: q.questionId, expectedQuestionRevision: qd.questions[0].revision, content: { clientMessageId: randomUUID(), body: 'Actual response resolves this question', fileVersionIds: [] }, idempotencyKey: randomUUID() });
    const rejected = await admin.mutate('/api/completion', stale);
    check('G11-H07 independent G09 mutation invalidates basis despite equal task CAS', rejected.status === 409 && (await rejected.json()).error.code === 'BASIS_CHANGED' && (await workspace()).taskRevision === stale.expectedTaskRevision, ['AC-11-02', 'A20']);
    const ext = action(target), revision = (await workspace()).taskRevision, extInput = { command: 'record_external', taskId, expectedTaskRevision: revision, action: ext, idempotencyKey: randomUUID() }, firstExternal = (await cmd(admin, extInput))[0], secondExternal = (await cmd(admin, { ...extInput, idempotencyKey: randomUUID(), action: { ...ext, purpose: 'final_use' } }))[0];
    const external = await brand.get<ExternalAction>(`/api/completion/external/${firstExternal}`), other = await brand.get<ExternalAction>(`/api/completion/external/${secondExternal}`);
    persist('actual-external', external);
    check('G11-H08 two purposes exact file performer recorder separate and no task status effect', external.purpose === 'review_request' && other.purpose === 'final_use' && external.effect === 'record_only' && external.performer.kind === 'external' && external.performer.label === 'Actual outside performer' && external.recordedByLabel !== external.performer.label && hash(sourceFacts(external)) === hash(sourceFacts(other)) && (await workspace()).taskRevision === revision && (await workspace()).taskStatus === 'partial', ['AC-11-03']);
    const sourceUrl = external.source.files[0].originalUrl, download = await brand.send(sourceUrl);
    check('G11-H09 authenticated exact source download matches original bytes', download.status === 200 && byteHash(Buffer.from(await download.arrayBuffer())) === byteHash(png), ['A19', 'D02']);
    const privateUpload = await admin.upload(`taskId=${taskId}`, png, 'PRIVATE_G11_FILE.png', 'image/png', 'internal');
    assert.equal(privateUpload.status, 201);
    const internalFile = (await privateUpload.json()).files[0].id;
    const hidden = (await cmd(admin, { command: 'record_external', expectedTaskRevision: revision, action: { ...ext, visibility: 'internal', evidenceFileVersionIds: [internalFile], latestProgress: 'G11_INTERNAL_ACTION' } }))[0];
    check('G11-H10 internal fact/evidence never in brand workspace or guessed download', !(JSON.stringify(await workspace(brand))).includes('G11_INTERNAL_ACTION') && (await brand.send(`/api/completion/external/${hidden}`)).status === 404 && (await brand.send(`/api/completion/files/${internalFile}?externalActionId=${hidden}`)).status === 404, ['A19', 'D02']);
    const complete = await completeInput(), preFault = await fixture<CompletionFixtureSnapshot>({ taskId }), fault = await fixture<CompletionFixtureSnapshot>({ taskId, action: 'lateFault', token: admin.token, command: complete });
    persist('late-fault', fault);
    check('G11-H11 real-producer late fault rolls back task snapshot event audit receipt', fault.fault === 'G11_PRIVATE_LATE_COMMIT_FAULT' && fault.rowsSha256 === preFault.rowsSha256, ['AC-11-05', 'A20'], 'DB_FIXTURE');
    const completed = (await cmd(admin, complete))[0], original = await snapshot(completed);
    persist('actual-completed-snapshot', original);
    check('G11-H12 GSG completes with missing correction externalwait and empty memo/proof', original.memo === '' && original.basis.currentEvaluation.state === 'available' && original.basis.currentEvaluation.value.missing === 1 && original.basis.inquiries.state === 'available' && original.basis.inquiries.value.externalWaiting === 1 && original.basis.corrections.state === 'available' && original.basis.corrections.value.unresolved === 1 && (await workspace()).summary.status === 'completed', ['AC-11-01', 'AC-11-02']);
    const publicSnapshot = await snapshot(completed, brand);
    check('G11-H13 current brand snapshot projection has own question and no hidden count/source/hash', publicSnapshot.basis.inquiries.state === 'available' && publicSnapshot.basis.inquiries.value.items.length === 1 && !JSON.stringify(publicSnapshot).includes('G11_OTHER_PRIVATE_QUESTION') && !JSON.stringify(publicSnapshot).includes('G11_PRIVATE') && !JSON.stringify(publicSnapshot).includes('G11_INTERNAL_ACTION') && !('basisHash' in publicSnapshot) && (await brand.get<SubmissionSnapshot>(`/api/submissions/${target.submissionId}`)).completion.status === 'completed', ['A19', 'D09']);
    const repeated = await cmd(admin, complete), facts = await fixture<CompletionFixtureSnapshot>({ taskId });
    check('G11-H14 exact same intent returns original one snapshot event receipt', repeated[0] === completed && facts.rows.find(x => x.kind === 'completionSnapshot')!.rows.length === 1 && facts.rows.find(x => x.kind === 'domainEvent')!.rows.filter(x => 'eventType' in x.data && x.data.eventType === 'TASK_MANUALLY_COMPLETED').length === 1, ['AC-11-05']);
    check('G11-H15 completed publish cannot silently reopen', (await admin.mutate(`/api/tasks/${taskId}`, { command: 'publish', expectedRevision: (await workspace()).taskRevision, idempotencyKey: randomUUID() })).status === 409, ['AC-11-04']);
    const reopen = { command: 'reopen', taskId, completionId: completed, expectedTaskRevision: (await workspace()).taskRevision, reason: '', idempotencyKey: randomUUID() };
    check('G11-H16 reopen requires explicit reason', (await admin.mutate('/api/completion', reopen)).status === 422, ['AC-11-04']);
    await cmd(admin, { ...reopen, reason: 'Actual followup requires work' });
    check('G11-H17 reasoned reopen restores actual partial state and preserves old snapshot', hash(await snapshot(completed)) === hash(original) && (await workspace()).summary.status === 'reopened' && (await workspace()).taskStatus === 'partial', ['AC-11-04']);
    const second = (await cmd(admin, await completeInput()))[0];
    check('G11-H18 new completion immutable chain retains old facts', (await snapshot(second)).previousCompletionId === completed && hash(await snapshot(completed)) === hash(original), ['AC-11-04']);
    const followupTaskId = await makeTask('Actual G04 followup'), followup = await workspace(admin, followupTaskId), link = { command: 'link_followup', taskId, completionId: completed, followupTaskId, expectedTaskRevision: (await workspace()).taskRevision, expectedFollowupRevision: followup.taskRevision, reason: 'Additional work', idempotencyKey: randomUUID() }, createdFacts = await fixture<CompletionFixtureSnapshot>({ taskId }), linkFault = await fixture<CompletionFixtureSnapshot>({ taskId, action: 'lateFault', token: admin.token, command: link });
    check('G11-H19 failed association retains real G04 task unchanged for association-only retry', linkFault.rowsSha256 === createdFacts.rowsSha256 && (await workspace(admin, followupTaskId)).taskId === followupTaskId, ['AC-11-04', 'A20'], 'DB_FIXTURE');
    const linked = await cmd(admin, link);
    check('G11-H20 linked followup retry stable and no second task', (await cmd(admin, link))[0] === linked[0] && (await workspace(brand)).followups[0].taskId === followupTaskId && (await fixture<CompletionFixtureSnapshot>({ taskId })).rows.find(x => x.kind === 'task')!.rows.length === createdFacts.rows.find(x => x.kind === 'task')!.rows.length, ['AC-11-04']);
    const raceTask = await makeTask('Actual simultaneous completion'), raceInput = await completeInput(raceTask), racer = new Client(mode === 'sqlite' ? auxPort : port);
    if (mode === 'sqlite')
        await start(auxPort);
    await racer.login('admin@example.test');
    const raced = await Promise.all([admin, racer].map(c => c.mutate('/api/completion', raceInput))), raceBodies = await Promise.all(raced.map(r => r.json()));
    check('G11-H21 same-intent actual sessions and twoOS SQLite one result', raced.every(r => r.status === 200) && hash(raceBodies[0]) === hash(raceBodies[1]), ['AC-11-05'], mode === 'sqlite' ? 'PROCESS' : 'HTTP');
    const raceFacts = await fixture<CompletionFixtureSnapshot>({ taskId: raceTask }), raceId = raceBodies[0].ids[0];
    persist('actual-race-facts', raceFacts);
    check('G11-H22 exact race produces one immutable snapshot event receipt', raceFacts.rows.find(x => x.kind === 'completionSnapshot')!.rows.filter(r => 'taskId' in r.data && r.data.taskId === raceTask).length === 1 && raceFacts.rows.find(x => x.kind === 'domainEvent')!.rows.filter(r => 'sourceVersionId' in r.data && r.data.sourceVersionId === raceId && 'eventType' in r.data && r.data.eventType === 'TASK_MANUALLY_COMPLETED').length === 1 && raceFacts.rows.find(x => x.kind === 'commandReceipt')!.rows.filter(r => 'result' in r.data && typeof r.data.result === 'object' && r.data.result && 'ids' in r.data.result && Array.isArray(r.data.result.ids) && r.data.result.ids.includes(raceId)).length === 1, ['AC-11-05'], 'DB_FIXTURE');
    const distinctTask = await makeTask('Actual distinct CAS'), distinct = await completeInput(distinctTask), cas = await Promise.all([admin, racer].map(c => c.mutate('/api/completion', { ...distinct, idempotencyKey: randomUUID() })));
    check('G11-H23 distinct stale intents exactly one wins', [...cas.map(r => r.status)].sort().join(',') === '200,409', ['AC-11-05'], mode === 'sqlite' ? 'PROCESS' : 'HTTP');
    const extended = await fixture<CompletionFixtureSnapshot>({ taskId, action: 'extension', snapshotId: completed });
    persist('stored-unknown-extra', extended);
    check('G11-H24 immutable unknown extension remains stored but not returned', JSON.stringify(extended).includes('G11_STORED_EXTRA') && !JSON.stringify(await snapshot(extended.fixtureSnapshotId!)).includes('G11_STORED_EXTRA'), ['A19']);
    const html = await (await brand.send(`/tasks/${taskId}?context=${A}`)).text();
    check('G11-H25 actual task SSR uses connected completion without private source markers', html.includes('G11 actual manual completion') && !html.includes('G11_PRIVATE_ORIGINAL') && !html.includes('G11_INTERNAL_ACTION'), ['A19', 'D09']);
    const preRestart = await fixture<CompletionFixtureSnapshot>({ taskId }), publicBefore = await workspace(brand), staffBefore = await workspace(admin);
    persist('before-restart', preRestart);
    if (mode === 'sqlite') {
        await stop(auxPort);
        await stop(port);
        await start();
        const freshBrand = new Client(), freshAdmin = new Client();
        await freshBrand.login('luna@example.test');
        await freshAdmin.login('admin@example.test');
        check('G11-H26 new PID real relogin preserves authorized histories', processes[0].pid !== processes.at(-1)!.pid && hash(await workspace(freshBrand)) === hash(publicBefore) && hash(await workspace(freshAdmin)) === hash(staffBefore), ['AC-11-04', 'D10'], 'PROCESS');
        check('G11-H27 all original business rows immutable after restart', (await fixture<CompletionFixtureSnapshot>({ taskId })).rowsSha256 === preRestart.rowsSha256, ['D10'], 'DB_FIXTURE');
        check('G11-H28 exact historical file bytes survive restart', byteHash(Buffer.from(await (await freshBrand.send(sourceUrl)).arrayBuffer())) === byteHash(png), ['D02', 'D10']);
    }
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
            };
        }[];
    }>(`/api/contexts/${A}/members`), member = members.members.find(m => m.data.userId === 'user-luna')!;
    assert.equal((await admin.mutate(`/api/contexts/${A}/members/${member.id}`, { expectedRevision: member.revision, status: 'suspended' }, 'PATCH')).status, 200);
    check('G11-H29 current membership revoke denies history file and commands', (await brand.send(`/api/completion/${completed}`)).status === 404 && (await brand.send(sourceUrl)).status === 404 && (await brand.mutate('/api/completion', complete)).status === 404, ['A19', 'D02']);
    check('G11-H30 revocation does not rewrite immutable completion facts', (await fixture<CompletionFixtureSnapshot>({ taskId })).completionSha256 === preRestart.completionSha256, ['AC-11-04', 'D10'], 'DB_FIXTURE');
    const bad = await fixture<CompletionFixtureSnapshot>({ taskId, action: 'corruption', snapshotId: completed });
    persist('stored-malformed-known', bad);
    const badResponse = await admin.send(`/api/completion/${bad.fixtureSnapshotId}`);
    check('G11-H31 malformed known persisted value safely503 and preserved raw', badResponse.status === 503 && !(await badResponse.text()).includes('G11_KNOWN_MALFORMED') && JSON.stringify(bad).includes('G11_KNOWN_MALFORMED') && (await fixture<CompletionFixtureSnapshot>({ taskId })).rowsSha256 === bad.rowsSha256, ['A19']);
    if (mode === 'sqlite') {
        const db = openDatabase(database);
        db.exec('ALTER TABLE records RENAME TO g11_private_unavailable_records');
        db.close();
        try {
            check('G11-H32 actual unavailable SQL relation is genuine503 not successful completion', (await admin.send(`/api/completion?taskId=${raceTask}`)).status === 503, ['AC-11-02'], 'DB_FIXTURE');
        }
        finally {
            const restore = openDatabase(database);
            restore.exec('ALTER TABLE g11_private_unavailable_records RENAME TO records');
            restore.close();
        }
        check('G11-H33 restoring own storage leaves all previously recorded rows unchanged', (await fixture<CompletionFixtureSnapshot>({ taskId })).rowsSha256 === bad.rowsSha256, ['D10'], 'DB_FIXTURE');
    }
    await admin.mutate('/api/auth/logout', {});
    check('G11-H34 revoked session cannot replay successful completion receipt', (await admin.mutate('/api/completion', complete)).status === 401, ['A19', 'AC-11-05']);
    reachedEnd = true;
}
catch (error) {
    failure = error instanceof Error ? error.message : 'unknown failure';
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const report = { candidate_commit: candidate, implementer_session_id: '01a0c307-9b54-7b83-b5eb-1b12b9a8553c', runner_sha256: hash(readFileSync('scripts/verify-completion-http.ts', 'utf8')), fixture_runner_sha256: hash(readFileSync('scripts/verify-completion-fixtures.ts', 'utf8')), status: failure ? 'FAIL' : 'PASS', mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, count_unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length + (failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0), skip: mode === 'mock' ? 5 : 0, skipped_ids: mode === 'mock' ? ['G11-H26', 'G11-H27', 'G11-H28', 'G11-H32', 'G11-H33'] : [], reachedEnd, not_run: 'G11 UI/independent/root acceptance; actual G12 cancellation and G16/17 AI failure; G13 delivery', checks, transcript, processes, resources: { port, auxPort, database, files }, fixture_boundary: 'Normal SQLite Next start; mock child repository injection/IPC for private observations and adversarial fixtures only. Actual HTTP G04/G05/G06/G09/G10/G11 producers. Late fault is explicit DB_FIXTURE service hook, not a product HTTP test endpoint.' };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, reportFile }));
}
