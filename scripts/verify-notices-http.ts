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
import { noticeFixture, type NoticeFixtureInput, type NoticeFixtureSnapshot } from "./verify-notices-fixtures";
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
            input: NoticeFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await noticeFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.NOTICES_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("NOTICES_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4183), auxPort = validPort(process.env.E2E_AUX_PORT, 4184);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.NOTICES_HTTP_ROOT ?? ".local/g08-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "notices.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.NOTICES_HTTP_REPORT ?? path.join(directory, "report.json"));
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
function check(id: string, condition: unknown, requirements = ["AC-08-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-notices-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g08_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
async function fixture<T>(input: NoticeFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await noticeFixture(repo, input) as T;
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
import { blankFileBinding } from '@/domain/products/types';
import type { ProductDetail } from '@/server/products/service';
import { blankNotice, type NoticeContent } from '@/domain/notices/types';
import type { NoticeDetail, NoticeList } from '@/server/notices/contracts';
import type { SubmissionWorkspace, UploadResult } from '@/server/submissions/contracts';
import { blankDraft } from '@/domain/submissions/types';
import { MAX_FILE_BYTES } from '@/domain/files/validate';
const A = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), team = new Client(), foreign = new Client(), operator = new Client(), newcomer = new Client();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
const byteHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const content = (extra: Partial<NoticeContent> = {}): NoticeContent => ({ ...blankNotice(), title: '합성 공지 v1', body: '별도 업무에서 자료를 제출해 주세요.', type: 'form', category: '입점 양식', documentVersion: '2026.1', ...extra });
const detail = (client: Client, id: string, versionId?: string) => client.get<NoticeDetail>(`/api/notices/${id}${versionId ? `?version=${versionId}` : ''}`);
const list = (client: Client, query = '') => client.get<NoticeList>(`/api/notices?context=${A}${query}`);
async function create(c = content(), contextId = A) {
    const response = await admin.mutate('/api/notices', { contextId, content: c, idempotencyKey: randomUUID() });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).ids[0] as string;
}
async function command(id: string, command: string, extra: Record<string, unknown> = {}) {
    const d = await detail(admin, id);
    const response = await admin.mutate(`/api/notices/${id}`, { command, expectedRevision: d.revision, idempotencyKey: randomUUID(), ...extra });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).ids as string[];
}
async function uploaded(id: string, bytes = png, name = 'synthetic.png', visibility = 'public') {
    const response = await admin.upload(`noticeId=${id}`, bytes, name, 'image/png', visibility);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).files[0] as {
        id: string;
        name: string;
        sha256: string;
    };
}
function persist(name: string, value: unknown) { writeFileSync(`${reportFile}.${name}.json`, JSON.stringify(value, null, 2), { mode: 0o600 }); }
async function taskCommand(id: string, command: string) {
    const d = await admin.get<TaskDetail>(`/api/tasks/${id}`);
    const r = await admin.mutate(`/api/tasks/${id}`, { command, expectedRevision: d.task.revision, idempotencyKey: randomUUID() });
    assert.equal(r.status, 200, await r.clone().text());
}
async function actualSubmission() {
    const c = { ...blankContent(), title: '공지에서 연결할 실제 제출 업무', description: '합성 제출', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '답변' }, { ...blankRequirement('remaining'), label: '남은 답변' }] };
    const created = await admin.mutate('/api/tasks', { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: ['product-serum'] }], content: c, category: 'spot', idempotencyKey: randomUUID() });
    assert.equal(created.status, 201, await created.clone().text());
    const id = (await created.json()).ids[0] as string;
    await taskCommand(id, 'publish');
    let w = await brand.get<SubmissionWorkspace>(`/api/tasks/${id}/submissions`);
    const csrf = await brand.get<{
        csrfToken: string;
    }>('/api/auth/csrf'), form = new FormData();
    form.append('files', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'submitted-original.png');
    form.append('clientItemIds', randomUUID());
    const url = `/api/tasks/${id}/submission-files?requestId=${w.request.id}`;
    const response = await fetch(brand.origin + url, { method: 'POST', headers: { Cookie: brand.cookie, Origin: brand.origin, 'X-CSRF-Token': csrf.csrfToken }, body: form });
    await capture(response, 'POST multipart', url);
    assert.equal(response.status, 200);
    const item = (await response.json()).items[0] as UploadResult;
    assert.equal(item.state, 'ready');
    if (item.state !== 'ready')
        throw Error('synthetic upload failed');
    const fileId = item.file.id;
    const product = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    const saved = await brand.mutate(`/api/tasks/${id}/submission-draft`, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: '실제 HTTP 합성 답변' } }], artifacts: [{ fileVersionId: fileId, role: 'editable_original', answer: null }], productSelections: [{ productId: 'product-serum', expectedCommonRevision: product.commonRevision, expectedContextRevision: product.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }] }, idempotencyKey: randomUUID() });
    assert.equal(saved.status, 200, await saved.clone().text());
    w = await brand.get<SubmissionWorkspace>(`/api/tasks/${id}/submissions`);
    const submitted = await brand.mutate(`/api/tasks/${id}/submissions`, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'partial', idempotencyKey: randomUUID() });
    assert.equal(submitted.status, 201, await submitted.clone().text());
    return { id, fileId };
}
let reachedEnd = false;
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    for (const [client, name] of [[admin, 'admin'], [brand, 'luna'], [team, 'team'], [foreign, 'wave'], [operator, 'operator'], [newcomer, 'none']] as const)
        await client.login(`${name}@example.test`);
    const id = await create(), f1 = await uploaded(id);
    check('anonymous list denied', (await new Client().send(`/api/notices?context=${A}`)).status === 401);
    check('brand draft hidden in list and exact detail', !(await list(brand)).items.some(n => n.id === id) && (await brand.send(`/api/notices/${id}`)).status === 404);
    check('draft upload denied before publication', (await brand.send(`/api/files/${f1.id}?noticeId=${id}&mode=original`)).status === 404, ['AC-08-01', 'D02']);
    check('brand cannot create or preview notices', (await brand.mutate('/api/notices', { contextId: A, content: content(), idempotencyKey: randomUUID() })).status === 403 && (await brand.send(`/api/notices/${id}?preview=1`)).status === 404);
    check('CSRF denied without mutation token', (await admin.send(`/api/notices/${id}`, 'POST', { command: 'publish' })).status === 403, ['A19']);
    check('eleven files rejected', (await admin.upload(`noticeId=${id}`, png, 'eleven.png', 'image/png', 'public', 11)).status === 422, ['D02']);
    check('over25MiB file rejected', (await admin.upload(`noticeId=${id}`, Buffer.alloc(MAX_FILE_BYTES + 1), 'large.png')).status === 422, ['D02']);
    check('false image signature rejected', (await admin.upload(`noticeId=${id}`, Buffer.from('not an image'), 'invalid.png')).status === 422, ['D02']);
    const internal = await uploaded(id, png, 'PRIVATE_INTERNAL_FILE.png', 'internal');
    await command(id, 'save', { content: content({ fileIds: [f1.id, internal.id] }) });
    const preview = await admin.get<{
        files: {
            id: string;
        }[];
    }>(`/api/notices/${id}?preview=1`);
    check('preview excludes internal file metadata', preview.files.length === 1 && preview.files[0].id === f1.id && !JSON.stringify(preview).includes(internal.id));
    const beforeInvalidPublish = await fixture<NoticeFixtureSnapshot>({ noticeId: id }), revision = (await detail(admin, id)).revision;
    check('internal attachment blocks public publish', (await admin.mutate(`/api/notices/${id}`, { command: 'publish', expectedRevision: revision, idempotencyKey: randomUUID() })).status === 422);
    check('failed publish leaves version pointer event unchanged', (await fixture<NoticeFixtureSnapshot>({ noticeId: id })).rowsSha256 === beforeInvalidPublish.rowsSha256, ['AC-08-03'], 'DB_FIXTURE');
    const actual = await actualSubmission();
    const c1 = content({ fileIds: [f1.id, actual.fileId], taskIds: [actual.id] });
    await command(id, 'save', { content: c1 });
    const publishInput = { command: 'publish', expectedRevision: (await detail(admin, id)).revision, idempotencyKey: randomUUID() };
    const pub = await admin.mutate(`/api/notices/${id}`, publishInput);
    assert.equal(pub.status, 200);
    const pubIds = (await pub.json()).ids as string[], v1 = pubIds[1];
    const replay = await admin.mutate(`/api/notices/${id}`, publishInput);
    check('publish same-key retry returns exact version', replay.status === 200 && hash((await replay.json()).ids) === hash(pubIds), ['AC-08-03']);
    check('altered same-key body conflicts', (await admin.mutate(`/api/notices/${id}`, { ...publishInput, versionId: 'different' })).status === 409, ['AC-08-03']);
    const public1 = await detail(brand, id), selected = public1.selected!;
    check('brand projection contains no draft roster internal file', !('draft' in public1) && !('roster' in public1) && !JSON.stringify(public1).includes(internal.id));
    check('source task status remains independently partial with actual submission', selected.content.tasks[0].id === actual.id && selected.content.tasks[0].status === 'partial' && !selected.content.tasks[0].completed && selected.content.tasks[0].ownAcceptedAt === null && !!selected.content.tasks[0].latestSubmittedAt, ['AC-08-02']);
    check('foreign context detail and list deny neutrally', (await foreign.send(`/api/notices/${id}`)).status === 404 && (await foreign.send(`/api/notices?context=${A}`)).status === 404);
    check('type category and unread filters consume real records', (await list(brand, '&type=form&q=입점&state=unread')).items.some(n => n.id === id) && !(await list(brand, '&type=faq')).items.some(n => n.id === id));
    check('invalid type and ambiguous exact version rejected', (await brand.send(`/api/notices?context=${A}&type=bad`)).status === 422 && (await brand.send(`/api/notices/${id}?version=${v1}&version=${v1}`)).status === 422 && (await brand.send(`/api/notices/${id}?version=`)).status === 422);
    for (const f of selected.content.files) {
        const bytes = Buffer.from(await (await brand.send(f.originalUrl)).arrayBuffer());
        check(`exact private notice reference bytes ${f.id}`, byteHash(bytes) === byteHash(png), ['AC-08-03', 'D02']);
    }
    check('internal file and mixed reference denied', (await brand.send(`/api/files/${internal.id}?noticeId=${id}&versionId=${v1}&mode=original`)).status === 404 && (await brand.send(`/api/files/${f1.id}?noticeId=${id}&taskId=${actual.id}&mode=original`)).status === 422, ['D02']);
    const beforeRead = await fixture<NoticeFixtureSnapshot>({ noticeId: id });
    persist('before-read', beforeRead);
    check('read invariance baseline includes an actual submission product capture', beforeRead.business.find(r => r.kind === 'productUseSnapshot')!.rows.length === 1 && beforeRead.business.find(r => r.kind === 'submission')!.rows.length === 1, ['AC-08-02'], 'DB_FIXTURE');
    const readInput = { command: 'read', versionId: v1, idempotencyKey: randomUUID() };
    const read = await brand.mutate(`/api/notices/${id}`, readInput);
    assert.equal(read.status, 200);
    const readIds = (await read.json()).ids;
    const readReplay = await brand.mutate(`/api/notices/${id}`, readInput), readNewKey = await brand.mutate(`/api/notices/${id}`, { ...readInput, idempotencyKey: randomUUID() });
    check('read same and new-key retries preserve one server-attributed fact', hash((await readReplay.json()).ids) === hash(readIds) && hash((await readNewKey.json()).ids) === hash(readIds));
    const afterRead = await fixture<NoticeFixtureSnapshot>({ noticeId: id });
    persist('after-read', afterRead);
    check('notice read leaves all task submission capture file records identical', beforeRead.businessSha256 === afterRead.businessSha256, ['AC-08-02'], 'DB_FIXTURE');
    const savedV1 = (await detail(brand, id)).selected;
    const managed = await detail(admin, id), readRows = afterRead.rows.find(r => r.kind === 'noticeRead')!.rows;
    check('GSG roster and brand own read agree with server user and time', 'roster' in managed && managed.roster.reads.length === 1 && managed.roster.reads[0].userId === 'user-luna' && managed.roster.reads[0].readAt === (await detail(brand, id)).selected!.ownReadAt && readRows.length === 1);
    const f2 = await uploaded(id, Buffer.concat([png, Buffer.from('second')]), 'second.png'), c2 = content({ title: 'PRIVATE_DRAFT_V2', body: 'PRIVATE_DRAFT_BODY', documentVersion: '2026.2', fileIds: [f2.id], taskIds: [actual.id], changeSummary: '양식 개정' });
    const beforeList = await list(brand);
    await command(id, 'save', { content: c2 });
    check('private draft keeps complete brand list and public metadata stable', hash(await list(brand)) === hash(beforeList) && !JSON.stringify(await detail(brand, id)).includes('PRIVATE_DRAFT'), ['AC-08-03']);
    const draftSnapshot = await fixture<NoticeFixtureSnapshot>({ noticeId: id });
    check('draft creates no publication event', draftSnapshot.rows.find(r => r.kind === 'domainEvent')!.rows.length === 1, ['AC-08-03'], 'DB_FIXTURE');
    const v2 = (await command(id, 'publish'))[1], latest = await detail(brand, id), historic = await detail(brand, id, v1);
    check('v2 unread while exact v1 body file read remain unchanged', latest.selected!.ownReadAt === null && hash(historic.selected) === hash(savedV1) && historic.selected!.content.body === c1.body && historic.selected!.ownReadAt !== null && latest.versions.length === 2, ['AC-08-03']);
    check('removed current file retained only through authorized historical version', (await brand.send(`/api/files/${f1.id}?noticeId=${id}&versionId=${v2}&mode=original`)).status === 404 && byteHash(Buffer.from(await (await brand.send(`/api/files/${f1.id}?noticeId=${id}&versionId=${v1}&mode=original`)).arrayBuffer())) === byteHash(png), ['AC-08-03', 'D02']);
    const versionSnapshot = await fixture<NoticeFixtureSnapshot>({ noticeId: id });
    persist('versions', versionSnapshot);
    check('two distinct version-bound durable events preserved', versionSnapshot.rows.find(r => r.kind === 'domainEvent')!.rows.length === 2 && hash(versionSnapshot.rows.find(r => r.kind === 'noticeRead')!.rows) === hash(readRows), ['AC-08-03'], 'DB_FIXTURE');
    const target = await create(content({ title: '선택 대상', audience: { mode: 'selected', userIds: ['user-luna'] } })), t1 = (await command(target, 'publish'))[1];
    check('selected target excludes current nonrecipient', (await team.send(`/api/notices/${target}`)).status === 404);
    await command(target, 'save', { content: content({ title: '전체 대상' }) });
    await command(target, 'publish');
    check('newly eligible reader cannot access previous excluded version or its ID', (await detail(team, target)).versions.length === 1 && !JSON.stringify(await detail(team, target)).includes(t1) && (await team.send(`/api/notices/${target}?version=${t1}`)).status === 404);
    await command(target, 'save', { content: content({ audience: { mode: 'selected', userIds: [] } }) });
    await command(target, 'publish');
    check('empty selection grants nobody and current exclusion denies old version', (await brand.send(`/api/notices/${target}?version=${t1}`)).status === 404 && (await team.send(`/api/notices/${target}`)).status === 404);
    const originNotice = await create(content({ title: '원본 권한 자료' })), originFile = await uploaded(originNotice, png, 'original-scope.png');
    const productBefore = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    check('unpublished notice file absent from product reuse picker', !productBefore.reusableFiles.some(f => f.id === originFile.id), ['D02']);
    const binding = blankFileBinding('notice-origin', originFile.id);
    const prematureBind = await admin.mutate('/api/products/product-serum', { contextId: A, command: 'save_files', files: [binding], expectedContextRevision: productBefore.contextRevision, idempotencyKey: randomUUID() });
    check('known unpublished notice file ID cannot bypass product binding', prematureBind.status === 422, ['D02']);
    await command(originNotice, 'save', { content: content({ fileIds: [originFile.id] }) });
    await command(originNotice, 'publish');
    const productReady = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    check('published notice file becomes permission-filtered reusable product source', productReady.reusableFiles.some(f => f.id === originFile.id), ['D02']);
    const bound = await brand.mutate('/api/products/product-serum', { contextId: A, command: 'save_files', files: [binding], expectedContextRevision: productReady.contextRevision, idempotencyKey: randomUUID() });
    check('actual product binding consumes published notice file owner', bound.status === 200, ['D02']);
    const targetNotice = await create(content({ title: '다른 공지에서 명시 참조', fileIds: [originFile.id] }));
    await command(targetNotice, 'publish');
    const targetFile = (await detail(brand, targetNotice)).selected!.content.files[0];
    check('explicit second notice reference serves exact original bytes', byteHash(Buffer.from(await (await brand.send(targetFile.originalUrl)).arrayBuffer())) === byteHash(png), ['D02']);
    const cross = await admin.mutate('/api/notices', { contextId: 'ctx-jp-b-luna', content: content({ fileIds: [originFile.id] }), idempotencyKey: randomUUID() });
    check('cross-context reference denied even for global GSG', cross.status === 404, ['D02']);
    await command(originNotice, 'save', { content: content({ audience: { mode: 'selected', userIds: ['user-team'] }, fileIds: [originFile.id] }) });
    await command(originNotice, 'publish');
    const afterOriginChange = await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    check('origin target exclusion hides reference metadata in notice and product', (await detail(brand, targetNotice)).selected!.content.files.length === 0 && !afterOriginChange.reusableFiles.some(f => f.id === originFile.id) && !afterOriginChange.files.some(f => f.fileVersionId === originFile.id), ['D02']);
    check('origin AND reference permissions deny original bytes through both consumers', (await brand.send(targetFile.originalUrl)).status === 404 && (await brand.send(`/api/files/${originFile.id}?productId=product-serum&contextId=${A}&mode=original`)).status === 404, ['D02']);
    const empty = await create(content({ title: '가입 후 공지' }), 'ctx-empty');
    await command(empty, 'publish');
    const emptyDetail = await detail(admin, empty);
    check('zero active target roster and scoped GSG denial', 'roster' in emptyDetail && emptyDetail.roster.targetCount === 0 && (await operator.send(`/api/notices/${empty}`)).status === 404);
    await fixture({ noticeId: empty, action: 'add_later_member' });
    check('later active member reads previously published all-member rule', (await detail(newcomer, empty)).selected!.content.title === '가입 후 공지');
    const racer = new Client(mode === 'sqlite' ? auxPort : port);
    if (mode === 'sqlite')
        await start(auxPort);
    await racer.login('admin@example.test');
    const raceRevision = (await detail(admin, id)).revision;
    const results = await Promise.all([admin, racer].map((c, i) => c.mutate(`/api/notices/${id}`, { command: 'save', expectedRevision: raceRevision, content: content({ title: `경합 ${i}`, fileIds: [f2.id] }), idempotencyKey: randomUUID() })));
    check('concurrent distinct-key CAS exactly one winner', results.map(r => r.status).sort().join(',') === '200,409', ['AC-08-03']);
    const sharedPublish = { command: 'publish', expectedRevision: (await detail(admin, id)).revision, idempotencyKey: randomUUID() };
    const publishes = await Promise.all([admin, racer].map(c => c.mutate(`/api/notices/${id}`, sharedPublish)));
    const replies = await Promise.all(publishes.map(r => r.json()));
    check('concurrent same-key publication produces exactly one version', publishes.every(r => r.status === 200) && hash(replies[0]) === hash(replies[1]), ['AC-08-03']);
    const extended = await fixture<NoticeFixtureSnapshot>({ noticeId: target, action: 'extend_version' });
    persist('stored-extension', extended);
    check('valid stored unknown extension remains stored without API exposure', JSON.stringify(extended).includes('G08_STORED_EXTENSION_CANARY') && !JSON.stringify(await detail(admin, target)).includes('G08_STORED_EXTENSION_CANARY'), ['A19']);
    const beforeRestart = await detail(brand, id), restartRows = await fixture<NoticeFixtureSnapshot>({ noticeId: id });
    if (mode === 'sqlite') {
        await stop(auxPort);
        await stop(port);
        await start();
        const relogged = new Client();
        await relogged.login('luna@example.test');
        check('SQLite new PID after actual server restart', processes[0].pid !== processes.at(-1)!.pid, ['AC-08-03'], 'PROCESS');
        check('relogin restores exact versions receipts task links and file metadata', hash(await detail(relogged, id)) === hash(beforeRestart) && (await fixture<NoticeFixtureSnapshot>({ noticeId: id })).rowsSha256 === restartRows.rowsSha256, ['AC-08-03']);
        check('restart historical original bytes remain exact', byteHash(Buffer.from(await (await relogged.send(`/api/files/${f1.id}?noticeId=${id}&versionId=${v1}&mode=original`)).arrayBuffer())) === byteHash(png), ['AC-08-03', 'D02']);
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
    check('current membership revoke denies detail history files and idempotent read replay', revoked.status === 200 && (await brand.send(`/api/notices/${id}`)).status === 404 && (await brand.send(`/api/notices/${id}?version=${v1}`)).status === 404 && (await brand.send(`/api/files/${f1.id}?noticeId=${id}&versionId=${v1}&mode=original`)).status === 404 && (await brand.mutate(`/api/notices/${id}`, readInput)).status === 404, ['AC-08-01', 'D02']);
    check('revocation does not erase immutable notice facts', (await fixture<NoticeFixtureSnapshot>({ noticeId: id })).rowsSha256 === restartRows.rowsSha256, ['AC-08-03'], 'DB_FIXTURE');
    reachedEnd = true;
}
catch (error) {
    failure = error instanceof Error ? error.message : 'unknown failure';
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const report = { candidate_commit: candidate, runner_sha256: hash(readFileSync('scripts/verify-notices-http.ts', 'utf8')), fixture_runner_sha256: hash(readFileSync('scripts/verify-notices-fixtures.ts', 'utf8')), status: failure ? 'FAIL' : 'PASS', mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length + (failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0), skip: 0, reachedEnd, not_run: 'Browser/UI/HTML/RSC, G07 assembly and independent verification remain NOT_RUN', checks, transcript, processes, resources: { primaryPort: port, auxPort, database, files }, fixture_boundary: 'Actual HTTP task/submission/notice/file producers. Private read snapshots; explicit later membership and unknown extension setup via IPC/repository only. No application test endpoint, no auth bypass.' };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, reportFile }));
}
