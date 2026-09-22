import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { migrate, openDatabase } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import type { TaskDetail } from "@/server/tasks/service";
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const mode = process.env.COMPLETION_CAMPAIGN_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("COMPLETION_CAMPAIGN_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4229), auxPort = validPort(process.env.E2E_AUX_PORT, 4230);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.COMPLETION_CAMPAIGN_ROOT ?? ".local/g11-campaign-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "completion.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.COMPLETION_CAMPAIGN_REPORT ?? path.join(directory, "report.json"));
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
    const origin = `http://127.0.0.1:${p}`, args = ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, IMPORT_STORAGE_DIR: path.join(directory, "imports"), APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g11_campaign_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
import type { CompletionWorkspace, CompletionSnapshot } from '@/server/completion/service';
import type { CampaignDetail } from '@/server/campaigns/contracts';
import type { CampaignDraft, MenuDraft, SourceText } from '@/domain/campaigns/types';
import type { ProductDetail } from '@/server/products/service';
import type { SubmissionWorkspace } from '@/server/submissions/contracts';
import type { MaterialTable } from '@/server/evidence/table';
import { blankCommon, blankContext } from '@/domain/products/types';
const A = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), person = { kind: 'user' as const, userId: 'user-luna' };
const source = (): SourceText => ({ source: 'PRIVATE_CAMPAIGN_SOURCE', sourceVersion: 'v1', locator: 'p2', language: 'ja', originalText: 'PRIVATE_ORIGINAL_QUOTE', translatedText: 'PRIVATE_TRANSLATION', fileVersionIds: [] });
const detail = (c: Client, id: string) => c.get<CampaignDetail>(`/api/campaigns/${id}`);
const workspace = (task: string, c = admin) => c.get<CompletionWorkspace>(`/api/completion?taskId=${task}`);
async function ids(response: Response, status = 200): Promise<string[]> { assert.equal(response.status, status, await response.clone().text()); return (await response.json()).ids; }
async function command(c: Client, id: string, command: string, extra: Record<string, unknown>) { const d = await detail(c, id); return ids(await c.mutate('/api/campaigns', { command, contextId: A, taskId: d.taskId, campaignId: id, expectedRevision: d.revision, idempotencyKey: randomUUID(), ...extra })); }
async function completion(taskId: string) { const w = await workspace(taskId); return { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() }; }
function residual(w: CompletionWorkspace) { const x = w.preview!.basis.campaign; assert.equal(x.state, 'available'); if (x.state !== 'available')
    throw Error('unavailable campaign'); return x.value; }
const skipped: string[] = [];
let reachedEnd = false;
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        (await repo.close());
    }
    await start();
    await admin.login('admin@example.test');
    await brand.login('luna@example.test');
    const p = await admin.get<ProductDetail>(`/api/products/product-serum?context=${A}`);
    const p2id = (await ids(await admin.mutate('/api/products', { contextId: A, brandId: p.context.data.brandId, common: { ...blankCommon(), name: '미선택 상품', code: 'C11-' + randomUUID() }, fields: blankContext(), idempotencyKey: randomUUID() }), 201))[0];
    const p2 = await admin.get<ProductDetail>(`/api/products/${p2id}?context=${A}`);
    const content = { ...blankContent(), title: 'G11 G12 actual completion', description: 'actual selected request', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('proof', 'file'), label: '사진' }, { ...blankRequirement('url', 'link'), label: 'URL' }, { ...blankRequirement('other', 'number'), label: '다른 메뉴' }] };
    const taskId = (await ids(await admin.mutate('/api/tasks', { category: 'spot', content, targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: [p.productId, p2id] }], idempotencyKey: randomUUID() }), 201))[0];
    await ids(await admin.mutate(`/api/tasks/${taskId}`, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }));
    check('C01 current empty campaign is connected and actual no campaigns, not unavailable', JSON.stringify(residual(await workspace(taskId))) === JSON.stringify({ requestSource: null, campaigns: [] }), ['AC-11-02']);
    const catalog = (await ids(await admin.mutate('/api/campaigns', { command: 'save_catalog', contextId: A, catalogId: null, expectedRevision: 0, idempotencyKey: randomUUID(), draft: { title: '합성 원문', versionLabel: 'v1', source: source() } })))[1];
    const menu = (key: string, first: boolean): MenuDraft => {
        const item = first ? p : p2, product = { productId: item.productId, productVersionId: item.commonVersionId, contextProductVersionId: item.contextVersionId, productUseId: null, sampleVariant: '샘플' };
        return { identity: { catalogVersionId: catalog, menuKey: key, menuName: first ? '촬영' : '미선택', menuNumber: '1' }, sourceStatements: [{ id: 'price', field: 'price', rawValue: 'PRIVATE_PRICE_12345', source: source() }], conflicts: [], conditions: { state: 'confirmed', sourceStatementIds: ['price'], publicExplanation: '공개 조건', cost: { amount: '12345', currency: 'JPY', taxIncluded: 'unknown' }, discount: 'PRIVATE_PRICE_DETAIL', points: '', cancellationTerms: '신청 후 협의', schedules: [] }, templateVersionId: null, request: { ...content, internalOriginal: 'PRIVATE_ORIGINAL', internalMemo: 'PRIVATE_MEMO', requirements: first ? content.requirements.slice(0, 2) : content.requirements.slice(2) }, products: [product], physical: first ? [{ key: 'shoot', purpose: '촬영', destination: '촬영 A', product, requestedQuantity: '1', unit: '개', plannedShip: content.deadline, plannedArrival: content.deadline }, { key: 'distribution', purpose: '배포', destination: '배포 B', product, requestedQuantity: '100', unit: '개', plannedShip: content.deadline, plannedArrival: content.deadline }] : [], followups: first ? [{ key: 'photo', kind: 'execution_photo', requirementKey: 'proof', deadline: content.deadline }, { key: 'url', kind: 'publication_url', requirementKey: 'url', deadline: content.deadline }] : [] };
    };
    const draft: CampaignDraft = { title: '실제 합성 행사', menus: [menu('one', true), menu('two', false), menu('three', false)] };
    const campaignId = (await ids(await admin.mutate('/api/campaigns', { command: 'save', contextId: A, taskId, campaignId: null, expectedRevision: 0, idempotencyKey: randomUUID(), draft })))[0];
    const versionId = (await command(admin, campaignId, 'publish', {}))[1];
    await command(brand, campaignId, 'participate', { campaignVersionId: versionId, response: 'participate', selectedMenus: [draft.menus[0].identity], providedBy: person, note: '' });
    let w = await workspace(taskId), r = residual(w), m = r.campaigns[0].menus[0];
    const sw = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`), table = await brand.get<MaterialTable>(`/api/evidence/table?context=${A}`);
    check('C02 literal selected1 actual request proof/url and unselected P2 material0', r.campaigns[0].menus.filter(x => x.active).length === 1 && sw.request.content.requirements.map(q => q.key).join(',') === 'proof,url' && r.requestSource?.materialProductIds.join(',') === p.productId && table.rows.find(x => x.productId === p2id)!.counts.requested === 0 && table.rows.find(x => x.productId === p2id)!.counts.missing === 0, ['C11-G12-01']);
    check('C03 active missing2/2/2; unselected missing0 reminderfalse', m.missingRequired === 2 && m.missingFollowup === 2 && m.missingReceiptObservation === 2 && r.campaigns[0].menus.slice(1).every(x => x.missingRequired === 0 && !x.reminderEligible), ['C11-G12-01']);
    const stale = await completion(taskId), taskBefore = (await admin.get<TaskDetail>(`/api/tasks/${taskId}`)).task;
    const physical = { campaignVersionId: versionId, menu: draft.menus[0].identity, physicalKey: 'shoot' }, provenance = { performedBy: person, occurredAt: null, evidence: [], note: 'PRIVATE_PHYSICAL_NOTE' };
    await command(brand, campaignId, 'physical', { ...physical, fact: { ...provenance, kind: 'tracking', carrier: '택배', trackingNumber: '0001', trackingUrl: null } });
    const staleReply = await admin.mutate('/api/completion', stale);
    w = await workspace(taskId);
    m = residual(w).campaigns[0].menus[0];
    check('C04 actual tracking stales basis409 while task revision unchanged and no completion written', staleReply.status === 409 && (await staleReply.json()).error.code === 'BASIS_CHANGED' && w.taskRevision === taskBefore.revision && w.history.length === 0, ['AC-11-02', 'AC-11-05']);
    check('C05 tracking alone dispatch0 receipt0, separate quantities1/100', m.physical[0].dispatchFacts === 0 && m.physical.every(x => x.receiptFacts === 0 && x.receipt === 'unconfirmed' && x.fulfillment === 'not_inferred') && m.physical.map(x => x.requestedQuantity).join(',') === '1,100', ['C11-G12-03']);
    const dispatch = (await command(brand, campaignId, 'physical', { ...physical, fact: { ...provenance, kind: 'dispatch', quantity: '1', unit: '개', carrier: '', trackingNumber: '0001' } }))[1];
    m = residual(await workspace(taskId)).campaigns[0].menus[0];
    check('C06 explicit dispatch still no receipt', m.physical[0].dispatchFacts === 1 && m.physical[0].receiptFacts === 0, ['C11-G12-03']);
    await command(admin, campaignId, 'external', { campaignVersionId: versionId, menu: draft.menus[0].identity, fact: { axis: 'application', value: 'applied', requester: person, performedBy: person, occurredAt: null, source: source(), note: 'PRIVATE_EXTERNAL_NOTE' } });
    await command(brand, campaignId, 'participate', { campaignVersionId: versionId, response: 'decline', selectedMenus: [], providedBy: person, note: '' });
    w = await workspace(taskId);
    r = residual(w);
    m = r.campaigns[0].menus[0];
    const declined = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    check('C07 actual applied decline canonical noMaterials and missing0; retained cancellation keys', declined.request.content.requirements.length === 0 && r.requestSource!.noMaterials && r.requestSource!.materialProductIds.length === 0 && r.requestSource!.retainedRequirementKeys.join(',') === 'proof,url' && !!r.requestSource!.retainedCancellationMenuKeys.length && w.preview!.basis.currentEvaluation.state === 'available' && w.preview!.basis.currentEvaluation.value.missing === 0, ['C11-G12-02']);
    check('C08 inactive aggregate0 separate cancellationhold/unconfirmedphysical/pendingfollowup', !m.active && m.retainedForCancellationReview && m.state.application === 'applied' && m.state.response === 'decline' && m.state.cancellation === 'discussion' && m.missingRequired === 0 && m.missingFollowup === 0 && m.missingReceiptObservation === 0 && !m.reminderEligible && m.physical.every(x => x.receipt === 'unconfirmed') && m.followups.every(x => x.status === 'pending'), ['C11-G12-02']);
    const cmd = await completion(taskId);
    check('C09 brand cannot manually complete', (await brand.mutate('/api/completion', cmd)).status === 403, ['AC-11-02']);
    const completed = (await ids(await admin.mutate('/api/completion', cmd)))[0], original = await brand.get<CompletionSnapshot>(`/api/completion/${completed}`);
    check('C10 noMemo actual complete with hold/unreceived, same intent one immutable snapshot', original.memo === '' && (await workspace(taskId)).taskStatus === 'completed' && (await ids(await admin.mutate('/api/completion', cmd)))[0] === completed && (await workspace(taskId)).history.length === 1, ['AC-11-01', 'AC-11-05']);
    check('C11 brand completion body excludes original price/private notes/basisHash', !JSON.stringify(original).includes('PRIVATE_') && !JSON.stringify(original).includes('12345') && !('basisHash' in original), ['A19', 'C11-G12-06']);
    await command(brand, campaignId, 'physical', { ...physical, fact: { ...provenance, kind: 'receipt', quantity: '0', unit: '개', dispatchFactIds: [dispatch] } });
    check('C12 later explicit receipt does not rewrite old completion', hash(await brand.get(`/api/completion/${completed}`)) === hash(original) && (await workspace(taskId)).taskStatus === 'completed', ['AC-11-04']);
    const reopen = await workspace(taskId);
    await ids(await admin.mutate('/api/completion', { command: 'reopen', taskId, completionId: completed, expectedTaskRevision: reopen.taskRevision, reason: '후속 실물 관찰', idempotencyKey: randomUUID() }));
    await command(brand, campaignId, 'participate', { campaignVersionId: versionId, response: 'participate', selectedMenus: [draft.menus[0].identity], providedBy: person, note: '' });
    m = residual(await workspace(taskId)).campaigns[0].menus[0];
    check('C13 quantity0 explicit receipt only removes one observation; no inferred fulfillment', m.active && m.missingReceiptObservation === 1 && m.physical[0].receipt === 'explicit_receipt_recorded' && m.physical[0].fulfillment === 'not_inferred' && m.physical[1].receiptFacts === 0, ['C11-G12-04']);
    const second = (await ids(await admin.mutate('/api/completion', await completion(taskId))))[0];
    check('C14 reasoned reopen second snapshot keeps first exact residual', second !== completed && (await workspace(taskId)).history.length === 2 && hash(await brand.get(`/api/completion/${completed}`)) === hash(original), ['AC-11-04']);
    const beforeRestart = await workspace(taskId, brand);
    if (mode === 'sqlite') {
        await stop(port);
        await start();
        await brand.login('luna@example.test');
        await admin.login('admin@example.test');
        check('C15 new PID real relogin exact campaign completion history', processes[0].pid !== processes.at(-1)!.pid && hash(await workspace(taskId, brand)) === hash(beforeRestart), ['D10'], 'PROCESS');
    }
    else
        skipped.push('C15');
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
            };
        }[];
    }>(`/api/contexts/${A}/members`), member = members.members.find(x => x.data.userId === 'user-luna')!;
    assert.equal((await admin.mutate(`/api/contexts/${A}/members/${member.id}`, { expectedRevision: member.revision, status: 'suspended' }, 'PATCH')).status, 200);
    check('C16 actual current revoke denies exact old completion and campaign source', (await brand.send(`/api/completion/${completed}`)).status === 404 && (await brand.send(`/api/campaigns/${campaignId}`)).status === 404, ['A19']);
    const frozen = await admin.get<CompletionSnapshot>(`/api/completion/${completed}`);
    check('C17 source revocation never rewrites old safe residual', hash(frozen.basis.campaign) === hash(original.basis.campaign), ['AC-11-04']);
    reachedEnd = true;
}
catch (error) {
    failure = error instanceof Error ? error.stack : 'unknown failure';
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const report = { candidate_commit: candidate, implementer_session_id: '01a0c307-9b54-7b83-b5eb-1b12b9a8553c', runner_sha256: hash(readFileSync('scripts/verify-completion-campaign-http.ts', 'utf8')), status: failure ? 'FAIL' : 'PASS', mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, count_unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length + (failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0), skip: skipped.length, skipped, reachedEnd, not_run: reachedEnd ? [] : 'Remaining checks after first failure', checks, transcript, processes, resources: { port, auxPort, database, files }, scope: 'Actual native Next HTTP G04/G06/G07/G12/G11 producer boundary; no mock response/DB fixture. UI/independent NOT_RUN.' };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, reportFile }));
}
