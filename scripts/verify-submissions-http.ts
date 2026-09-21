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
import { blankFileBinding } from "@/domain/products/types";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import type { ProductDetail } from "@/server/products/service";
import type { TaskDetail } from "@/server/tasks/service";
import { submissionFixture, type SubmissionFixtureInput, type SubmissionFixtureSnapshot } from "./verify-submissions-fixtures";
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
            input: SubmissionFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await submissionFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.SUBMISSIONS_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("SUBMISSIONS_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4151), auxPort = validPort(process.env.E2E_AUX_PORT, 4154);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.SUBMISSIONS_HTTP_ROOT ?? ".local/g05-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "submissions.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.SUBMISSIONS_HTTP_REPORT ?? path.join(directory, "report.json"));
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
}[] = [];
const children = new Map<number, ChildProcess>();
let failure: string | undefined;
function check(id: string, condition: unknown, requirements = ["AC-05-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-submissions-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g05_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
async function fixture<T>(input: SubmissionFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await submissionFixture(repo, input) as T;
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
        transcript.push({ method, path: url, status: response.status });
        return response;
    }
    async get<T>(url: string): Promise<T> { const response = await this.send(url); assert.equal(response.status, 200, `GET ${url}`); const body = await response.text(); transcript.at(-1)!.responseSha256 = hash(body); return JSON.parse(body) as T; }
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
        transcript.push({ method: "POST multipart", path: `/api/files?${query}`, status: response.status });
        return response;
    }
}
import type { SubmissionWorkspace, SubmissionSnapshot, DraftContent, SubmitCommand, UploadResult, EvaluationResult } from "@/server/submissions/contracts";
import { blankDraft, type AnswerInput } from "@/domain/submissions/types";
import { MAX_FILE_BYTES } from "@/domain/files/validate";
const A = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), co = new Client(), team = new Client(), foreign = new Client();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const workspace = (client: Client, id: string) => client.get<SubmissionWorkspace>(`/api/tasks/${id}/submissions`);
async function taskCommand(id: string, command: string, extra: Record<string, unknown> = {}) { const d = await admin.get<TaskDetail>(`/api/tasks/${id}`); const response = await admin.mutate(`/api/tasks/${id}`, { command, expectedRevision: d.task.revision, idempotencyKey: randomUUID(), ...extra }); assert.equal(response.status, 200, await response.clone().text()); return response; }
const requestContent = () => ({ ...blankContent(), title: 'G05 HTTP 합성 자료', description: '합성 답변을 제출해 주세요', internalMemo: 'G05_REQUEST_PRIVATE_CANARY', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [
        { ...blankRequirement('short', 'short_text'), label: '한 줄' }, { ...blankRequirement('long', 'long_text'), label: '상세' }, { ...blankRequirement('file', 'file'), label: '자료' }, { ...blankRequirement('choice', 'choice'), label: '선택', options: ['yes', 'no'] }, { ...blankRequirement('number', 'number'), label: '수량', unit: '개' }, { ...blankRequirement('date', 'date'), label: '기록일' }, { ...blankRequirement('link', 'link'), label: '영상 링크' }, { ...blankRequirement('physical', 'physical_record'), label: '실물 기록' }
    ] });
async function createTask(content = requestContent(), productIds = ['product-serum']) { const response = await admin.mutate('/api/tasks', { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds }], content, category: 'spot', idempotencyKey: randomUUID() }); assert.equal(response.status, 201, await response.clone().text()); const id = (await response.json()).ids[0] as string; await taskCommand(id, 'publish'); return id; }
async function save(id: string, content: DraftContent, client = brand, providedBy?: unknown) { const w = await workspace(client, id); const response = await client.mutate(`/api/tasks/${id}/submission-draft`, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft?.revision ?? 0, content, providedBy, idempotencyKey: randomUUID() }); assert.equal(response.status, 200, await response.clone().text()); return response; }
async function submitInput(id: string, mode: 'partial' | 'full' = 'full'): Promise<SubmitCommand> { const w = await workspace(brand, id); return { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode, idempotencyKey: randomUUID() }; }
async function submit(id: string, input: SubmitCommand, client = brand) { return client.mutate(`/api/tasks/${id}/submissions`, input); }
type FileItem = {
    clientItemId: string;
    name: string;
    type: string;
    bytes: Buffer;
};
async function upload(id: string, items: FileItem[], client = brand) { const w = await workspace(client, id), csrf = await client.get<{
    csrfToken: string;
}>('/api/auth/csrf'), form = new FormData(); for (const f of items) {
    form.append('files', new Blob([new Uint8Array(f.bytes)], { type: f.type }), f.name);
    form.append('clientItemIds', f.clientItemId);
} const url = `/api/tasks/${id}/submission-files?requestId=${w.request.id}`; const response = await fetch(client.origin + url, { method: 'POST', headers: { Cookie: client.cookie, Origin: client.origin, 'X-CSRF-Token': csrf.csrfToken }, body: form }); transcript.push({ method: 'POST multipart', path: url, status: response.status }); return response; }
const item = (name = 'synthetic.png', bytes = png, type = 'image/png'): FileItem => ({ clientItemId: randomUUID(), name, bytes, type });
async function received(response: Response): Promise<UploadResult[]> { assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).items; }
const shaBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let checksReachedEnd = false;
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    for (const [client, email] of [[admin, 'admin'], [brand, 'luna'], [co, 'co'], [team, 'team'], [foreign, 'wave']] as const)
        await client.login(`${email}@example.test`);
    const tid = await createTask(), initial = await workspace(brand, tid), requestId = initial.request.id;
    check('anonymous workspace denied', (await new Client().send(`/api/tasks/${tid}/submissions`)).status === 401, ['AC-05-05', 'A19']);
    check('foreign task workspace neutral404', (await foreign.send(`/api/tasks/${tid}/submissions`)).status === 404, ['AC-05-05', 'A19']);
    check('nonassignee cannot mutate shared draft', (await team.mutate(`/api/tasks/${tid}/submission-draft`, { command: 'save', baseRequestId: requestId, expectedDraftRevision: 0, content: blankDraft(), idempotencyKey: randomUUID() })).status === 403, ['AC-05-05']);
    check('CSRF required for draft mutation', (await brand.send(`/api/tasks/${tid}/submission-draft`, 'POST', {})).status === 403, ['A19']);
    check('request internal fields absent', !JSON.stringify(initial).includes('G05_REQUEST_PRIVATE_CANARY'), ['A19']);
    const good = item(), bad = item('bad.png', Buffer.from('not-png')), mixed = await received(await upload(tid, [good, bad]));
    check('mixed upload keeps success and failed row', mixed.length === 2 && mixed[0].state === 'ready' && mixed[1].state === 'failed', ['SA-19']);
    assert(mixed[0].state === 'ready');
    const firstFile = mixed[0].file;
    check('stable client item retry returns same file', hash((await received(await upload(tid, [good])))[0]) === hash(mixed[0]), ['SA-19']);
    const replaced = await received(await upload(tid, [{ ...good, bytes: Buffer.concat([png, Buffer.from('changed')]) }]));
    check('same item key different bytes conflicts', replaced[0].state === 'failed' && replaced[0].error.code === 'CONFLICT', ['SA-19']);
    check('temporary upload does not change task state', (await workspace(brand, tid)).taskStatus === 'requested', ['SA-16', 'SA-17']);
    check('temporary file withheld from teammate', (await team.send(firstFile.originalUrl)).status === 404, ['SA-21', 'A19']);
    check('temporary file withheld from product picker', !(await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`)).reusableFiles.some(f => f.id === firstFile.id), ['SA-21']);
    const beforeProduct = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`), binding = blankFileBinding('submission-proof', firstFile.id);
    check('direct unpublished product binding denied', (await brand.mutate('/api/products/product-serum', { command: 'save_files', contextId: A, expectedContextRevision: beforeProduct.contextRevision, files: [binding], idempotencyKey: randomUUID() })).status === 422, ['SA-21', 'D09']);
    const formats = [item('synthetic.pdf', Buffer.from('%PDF-1.4\nsynthetic'), 'application/pdf'), item('synthetic.jpg', Buffer.from([255, 216, 255, 0]), 'image/jpeg'), item('synthetic.xls', Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]), 'application/vnd.ms-excel'), item('synthetic.xlsx', Buffer.from('PK\u0003\u0004xl/synthetic'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), item('synthetic.csv', Buffer.from('a,b\n0,1'), 'text/csv'), item('synthetic.doc', Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]), 'application/msword'), item('synthetic.docx', Buffer.from('PK\u0003\u0004word/synthetic'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), item('synthetic.ppt', Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]), 'application/vnd.ms-powerpoint'), item('synthetic.pptx', Buffer.from('PK\u0003\u0004ppt/synthetic'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), item('synthetic.ai', Buffer.from('%!PS-Adobe synthetic'), 'application/postscript'), item('synthetic.zip', Buffer.from('PK\u0003\u0004synthetic'), 'application/zip'), item('synthetic.mp4', Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]), 'video/mp4'), item('synthetic.mov', Buffer.from([0, 0, 0, 12, 109, 111, 111, 118, 0, 0, 0, 0]), 'video/quicktime')];
    const storedFormats: Extract<UploadResult, {
        state: 'ready';
    }>[] = [];
    for (const batch of [formats.slice(0, 10), formats.slice(10)])
        for (const result of await received(await upload(tid, batch))) {
            assert(result.state === 'ready');
            storedFormats.push(result);
        }
    check('all supported office AI ZIP video formats stored', storedFormats.length === formats.length, ['SA-18']);
    for (let i = 0; i < formats.length; i++) {
        const response = await brand.send(storedFormats[i].file.originalUrl);
        check(`exact original bytes ${formats[i].name}`, response.status === 200 && shaBytes(Buffer.from(await response.arrayBuffer())) === shaBytes(formats[i].bytes), ['SA-18', 'AC-05-02']);
    }
    check('AI file preview is explicitly unavailable', storedFormats.find(f => f.file.name.endsWith('.ai'))!.file.preview === false, ['SA-18']);
    check('eleven files rejected', (await upload(tid, Array.from({ length: 11 }, () => item()))).status === 422, ['SA-19']);
    const exact = Buffer.alloc(MAX_FILE_BYTES, 65);
    exact.set(png);
    const limits = await received(await upload(tid, [item('exact.png', exact), item('too-large.png', Buffer.concat([exact, Buffer.from([0])]))]));
    check('25MiB exact accepted plusone rejected', limits[0].state === 'ready' && limits[1].state === 'failed', ['SA-19']);
    const inputs = { short_text: { text: '합성 한 줄' }, long_text: { text: '합성 상세\n줄바꿈' }, file: { fileVersionIds: [firstFile.id] }, choice: { selected: ['yes'] }, number: { value: '' }, date: { value: '2026-09-21', precision: 'date', timezone: 'Asia/Seoul' }, link: { url: 'https://example.test/synthetic-video', description: '합성 링크', contentFixed: false, fixedReference: { kind: 'external', identifier: 'synthetic-version-v1', source: '제공자 명시 ID' } }, physical_record: { summary: '제공자 실물 사실 기록', items: [{ productId: 'product-serum', quantity: '0', unit: '개' }], evidenceFileVersionIds: [firstFile.id], observedAt: null, source: '합성 제공자 기록' } };
    let content: DraftContent = { ...blankDraft(), answers: initial.request.content.requirements.map(q => ({ requestId, requirementKey: q.key, productId: null, type: q.type, input: inputs[q.type] }) as AnswerInput), narrative: '합성 제출 설명', artifacts: [{ fileVersionId: firstFile.id, role: 'editable_original', answer: { requirementKey: 'file', productId: null } }, { fileVersionId: storedFormats[0].file.id, role: 'review_copy', answer: null }], links: [{ url: 'https://example.test/large-video', description: '대용량 합성 영상', contentFixed: false, fixedReference: null }], productSelections: [{ productId: 'product-serum', expectedCommonRevision: beforeProduct.commonRevision, expectedContextRevision: beforeProduct.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }] };
    check('brand cannot forge actual provider', (await brand.mutate(`/api/tasks/${tid}/submission-draft`, { command: 'save', baseRequestId: requestId, expectedDraftRevision: 0, content, providedBy: { kind: 'user', userId: 'user-admin' }, idempotencyKey: randomUUID() })).status === 403, ['AC-05-05']);
    await save(tid, content);
    let w = await workspace(brand, tid);
    check('draft roundtrip typed8 narrative artifacts variable link', w.draft!.content.answers.length === 8 && w.draft!.content.narrative === content.narrative && w.draft!.content.artifacts.length === 2 && w.draft!.content.links[0].contentFixed === false, ['SA-15', 'SA-16', 'SA-20']);
    const evaluated = await brand.mutate(`/api/tasks/${tid}/submission-evaluation`, { baseRequestId: requestId, content });
    const evaluation = await evaluated.json() as EvaluationResult;
    check('exact missing one required item', evaluated.status === 200 && evaluation.evaluation.missing === 1 && evaluation.evaluation.items.find(i => i.requirementKey === 'number')?.status === 'missing', ['SA-17']);
    check('full incomplete rejected', (await submit(tid, await submitInput(tid))).status === 422, ['SA-17']);
    const partialInput = await submitInput(tid, 'partial'), partial = await submit(tid, partialInput);
    check('actual partial submit accepted', partial.status === 201, ['AC-05-01', 'SA-17']);
    const v1id = (await partial.json()).ids[0] as string, v1 = await brand.get<SubmissionSnapshot>(`/api/submissions/${v1id}`), storedV1 = await fixture<SubmissionFixtureSnapshot>({ taskId: tid });
    check('snapshot provider recorder and original file uploader distinct facts', v1.providedBy.kind === 'user' && v1.providedBy.userId === 'user-luna' && v1.recordedBy === 'user-luna' && v1.files[0].uploaderLabel.length > 0 && storedV1.files.find(f => f.id === firstFile.id)?.uploaderId === 'user-luna', ['AC-05-02', 'AC-05-05']);
    check('task progress partial with one actual audit outbox', (await workspace(team, tid)).taskStatus === 'partial' && storedV1.audits === 1 && storedV1.events === 1, ['SA-16', 'SA-17'], 'DB_FIXTURE');
    const retry = await submit(tid, partialInput), newKeyRetry = await submit(tid, { ...partialInput, idempotencyKey: randomUUID() });
    check('response loss and newkey consume same exact draft once', retry.status === 201 && newKeyRetry.status === 201 && (await retry.json()).ids[0] === v1id && (await newKeyRetry.json()).ids[0] === v1id && (await fixture<SubmissionFixtureSnapshot>({ taskId: tid })).submissions.length === 1, ['SA-17', 'A20']);
    check('submitted exact file becomes team readable', (await team.send(firstFile.downloadUrl)).status === 200, ['SA-21']);
    const released = await team.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    check('actual G05 inclusion enables product picker', released.reusableFiles.some(f => f.id === firstFile.id), ['SA-21']);
    const bound = await team.mutate('/api/products/product-serum', { command: 'save_files', contextId: A, expectedContextRevision: released.contextRevision, files: [binding], idempotencyKey: randomUUID() });
    check('actual released file binds product', bound.status === 200, ['D09', 'SA-21']);
    const p2 = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    content = { ...content, answers: content.answers.map(a => a.type === 'number' ? { ...a, input: { value: '0' } } : a), productSelections: [{ ...content.productSelections[0], expectedContextRevision: p2.contextRevision, bindingIds: [binding.id] }] };
    await save(tid, content);
    const full = await submit(tid, await submitInput(tid));
    check('actual full structural submit accepted', full.status === 201, ['AC-05-01']);
    const v2id = (await full.json()).ids[0] as string, v2 = await brand.get<SubmissionSnapshot>(`/api/submissions/${v2id}`);
    check('live full progress is separate from no teammate draft', ((w = await workspace(team, tid)), w.draft === null && w.draftEvaluation === null && w.submittedEvaluation!.evaluation.missing === 0 && w.taskStatus === 'submitted' && !v2.review.connected && !v2.completion.connected), ['SA-17']);
    check('v1 text file product snapshot remains exact after v2', hash(await brand.get(`/api/submissions/${v1id}`)) === hash(v1) && (await fixture<SubmissionFixtureSnapshot>({ taskId: tid })).submissions.find(s => s.id === v1id)!.sha256 === storedV1.submissions[0].sha256, ['AC-05-04', 'D06'], 'DB_FIXTURE');
    check('real submission capture owner and public exact file binding', v2.products[0].files[0].fileVersionId === firstFile.id && (await fixture<SubmissionFixtureSnapshot>({ taskId: tid })).uses.every(u => u.ownerType === 'submission'), ['D09']);
    const currentProduct = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    assert.equal((await brand.mutate('/api/products/product-serum', { command: 'save_common', contextId: A, expectedCommonRevision: currentProduct.commonRevision, common: { ...currentProduct.common, name: '상품 현재본 변경' }, idempotencyKey: randomUUID() })).status, 200);
    await save(tid, { ...content, narrative: '상품 변경 뒤 새 제출' });
    check('stale product revision conflicts instead of hidden latest', (await submit(tid, await submitInput(tid))).status === 409, ['D09']);
    check('old exact use unchanged after current product edit', hash(await brand.get(`/api/submissions/${v2id}`)) === hash(v2), ['D09']);
    const refreshed = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    content.productSelections[0].expectedCommonRevision = refreshed.commonRevision;
    await save(tid, content);
    const nextRequest = requestContent();
    nextRequest.requirements.push({ ...blankRequirement('added', 'long_text'), label: '추가 요청' });
    await taskCommand(tid, 'save', { content: nextRequest });
    await taskCommand(tid, 'publish');
    w = await workspace(brand, tid);
    check('actual old submission stays exact and new required item missing', w.requiresRebase && w.taskStatus === 'requested' && w.submittedEvaluation!.evaluation.items.some(i => i.requirementKey === 'added' && i.status === 'missing') && hash(await brand.get(`/api/submissions/${v1id}`)) === hash(v1), ['D06']);
    check('old request draft write rejected', (await brand.mutate(`/api/tasks/${tid}/submission-draft`, { command: 'save', baseRequestId: requestId, expectedDraftRevision: w.draft!.revision, content, idempotencyKey: randomUUID() })).status === 409, ['D06']);
    const rebase = await brand.mutate(`/api/tasks/${tid}/submission-draft`, { command: 'rebase_apply', baseRequestId: requestId, targetRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, carryAnswers: content.answers.map(a => ({ requirementKey: a.requirementKey, productId: a.productId })), idempotencyKey: randomUUID() });
    check('explicit compatible rebase succeeds', rebase.status === 200, ['D06']);
    w = await workspace(brand, tid);
    content = w.draft!.content;
    content.answers.push({ requestId: w.request.id, requirementKey: 'added', productId: null, type: 'long_text', input: { text: '추가 항목 답변' } });
    await save(tid, content);
    check('new request actual resubmit succeeds', (await submit(tid, await submitInput(tid))).status === 201, ['D06']);
    await taskCommand(tid, 'hold', { reason: '합성 보류' });
    await taskCommand(tid, 'cancel', { reason: '합성 취소' });
    await save(tid, { ...content, narrative: '보류 중 보존할 초안' });
    check('paused draft save preserved while submit blocked', (await workspace(brand, tid)).draft!.content.narrative === '보류 중 보존할 초안' && (await submit(tid, await submitInput(tid))).status === 409, ['SA-17']);
    await taskCommand(tid, 'resume', { reason: '합성 재개' });
    check('nested pause restores submitted progress', (await workspace(brand, tid)).taskStatus === 'submitted', ['D06']);
    let racer = co;
    if (mode === 'sqlite') {
        await start(auxPort);
        racer = new Client(auxPort);
        await racer.login('co@example.test');
    }
    w = await workspace(brand, tid);
    const raceBody = { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, content, idempotencyKey: randomUUID() };
    const draftRace = await Promise.all([brand, racer].map((client, index) => client.mutate(`/api/tasks/${tid}/submission-draft`, { ...raceBody, idempotencyKey: randomUUID(), content: { ...content, narrative: `경합 ${index}` } })));
    check('concurrent shared draft CAS exactly one winner', draftRace.map(r => r.status).sort().join(',') === '200,409', ['A20', 'SA-17']);
    const submitRaceInput = await submitInput(tid), submissionRace = await Promise.all([brand, racer].map(client => submit(tid, { ...submitRaceInput, idempotencyKey: randomUUID() }, client)));
    const raceIds = await Promise.all(submissionRace.map(r => r.json()));
    check('concurrent exact draft consumed once across actor/process', submissionRace.every(r => r.status === 201) && raceIds[0].ids[0] === raceIds[1].ids[0], ['A20', 'SA-17']);
    const proxyId = await createTask({ ...requestContent(), requirements: [{ ...blankRequirement('text', 'long_text'), label: '제조사 제공 답변' }] }, []), proxyW = await workspace(admin, proxyId);
    await save(proxyId, { ...blankDraft(), answers: [{ requestId: proxyW.request.id, requirementKey: 'text', productId: null, type: 'long_text', input: { text: '제조사 자료 기록' } }] }, admin, { kind: 'external_source', label: '합성 제조사', source: '합성 원문 메일' });
    const proxyReply = await submit(proxyId, await submitInput(proxyId), admin);
    assert.equal(proxyReply.status, 201);
    const proxy = await brand.get<SubmissionSnapshot>(`/api/submissions/${(await proxyReply.json()).ids[0]}`);
    check('actual GSG proxy preserves providedBy and forced recorder', proxy.providedBy.kind === 'external_source' && proxy.recordedBy === 'user-admin' && proxy.answers[0].provenance.recordedBy === 'user-admin', ['AC-05-05']);
    const beforeRestart = await workspace(brand, tid), beforeDb = await fixture<SubmissionFixtureSnapshot>({ taskId: tid });
    if (mode === 'sqlite') {
        await stop(auxPort);
        await stop(port);
        await start();
        const relogged = new Client();
        await relogged.login('luna@example.test');
        check('actual new PID after SQLite restart', processes[0].pid !== processes.at(-1)!.pid, ['A20'], 'PROCESS');
        check('relogin restores exact draft/submission/product references', hash(await workspace(relogged, tid)) === hash(beforeRestart), ['AC-05-03', 'AC-05-04', 'A20']);
        check('restart preserves exact original bytes', shaBytes(Buffer.from(await (await relogged.send(firstFile.originalUrl)).arrayBuffer())) === shaBytes(png), ['AC-05-02', 'A20']);
        check('restart immutable record hashes unchanged', hash(await fixture<SubmissionFixtureSnapshot>({ taskId: tid })) === hash(beforeDb), ['A20'], 'DB_FIXTURE');
    }
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
                scope: string;
            };
        }[];
    }>(`/api/contexts/${A}/members`), member = members.members.find(m => m.data.userId === 'user-luna')!;
    const revoked = await admin.mutate(`/api/contexts/${A}/members/${member.id}`, { expectedRevision: member.revision, status: 'suspended', scope: member.data.scope, internalPriceAccess: false }, 'PATCH');
    check('actual membership revoke denies draft snapshot file replay', revoked.status === 200 && (await brand.send(`/api/tasks/${tid}/submissions`)).status === 404 && (await brand.send(`/api/submissions/${v1id}`)).status === 404 && (await brand.send(firstFile.originalUrl)).status === 404 && (await submit(tid, partialInput)).status === 404, ['AC-05-05', 'A19']);
    check('revocation preserves original immutable rows', hash((await fixture<SubmissionFixtureSnapshot>({ taskId: tid })).files) === hash(beforeDb.files), ['AC-05-04'], 'DB_FIXTURE');
    checksReachedEnd = true;
}
catch (error) {
    failure = error instanceof Error ? error.message : 'unknown failure';
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const report = { candidate_commit: candidate, runner_sha256: hash(readFileSync('scripts/verify-submissions-http.ts', 'utf8')), fixture_runner_sha256: hash(readFileSync('scripts/verify-submissions-fixtures.ts', 'utf8')), status: failure ? 'FAIL' : 'PASS', mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length + (failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0), skip: 0, not_run: checksReachedEnd ? 'Browser/UI/RSC and independent verification remain NOT_RUN' : 'remaining assertions interrupted; browser/UI/RSC NOT_RUN', checks, transcript, processes, resources: { primaryPort: port, auxPort, database, files }, fixture_boundary: 'Actual HTTP producer; private repository read-only snapshots and synthetic mock IPC only; no credentials/cookies logged' };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, reportFile }));
}
