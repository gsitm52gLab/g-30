import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
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
import { blankCommon, blankContext, blankFileBinding, blankRetailPrice, blankInternalPrice } from "@/domain/products/types";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import type { ProductDetail, ProductList, ProductImpact } from "@/server/products/service";
import type { TaskDetail } from "@/server/tasks/service";
import { productFixture, PRODUCT_CANARY, type FixtureRequest } from "./verify-products-fixtures";
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
            input: FixtureRequest;
        };
        try {
            process.send?.({ id: m.id, value: await productFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.PRODUCTS_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("PRODUCTS_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4161), auxPort = validPort(process.env.E2E_AUX_PORT, 4164);
assert.notEqual(port, auxPort);
mkdirSync(".data", { recursive: true });
const directory = mkdtempSync(path.resolve(`.data/g06-http-${mode}-`)), database = path.join(directory, "products.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.PRODUCTS_HTTP_REPORT ?? path.join(directory, "report.json"));
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
function check(id: string, condition: unknown, requirements = ["AC-06-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-products-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g06_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
interface FixtureSnapshot {
    fileProvenance: {
        id: string;
        uploaderId: string;
        createdAt: string;
        sha256: string;
    }[];
    sha256: string;
    canaryStored: boolean;
    uses: {
        id: string;
        sha256: string;
        contentHash: string;
        fileBindingHash: string;
    }[];
    receipts: {
        id: string;
        sha256: string;
        canaryStored: boolean;
    }[];
}
async function fixture<T>(input: FixtureRequest): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await productFixture(repo, input) as T;
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
const A = "ctx-jp-a-luna", B = "ctx-jp-b-luna", admin = new Client(), brand = new Client(), team = new Client(), gsg = new Client(), price = new Client(), foreign = new Client();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=", "base64"), privatePriceValue = "7777777777777777777777777.77";
const detail = (client: Client, pid: string, contextId = A) => client.get<ProductDetail>(`/api/products/${pid}?context=${contextId}`);
async function command(client: Client, pid: string, name: string, body: Record<string, unknown>, contextId = A) { const response = await client.mutate(`/api/products/${pid}`, { contextId, command: name, idempotencyKey: randomUUID(), ...body }); assert.equal(response.status, 200, `${name} status ${await response.clone().text()}`); return response; }
async function create(client: Client, code: string, contextId = A, common = { ...blankCommon(), name: "합성 HTTP 상품", code }) { const body = { contextId, brandId: "brand-luna", common, idempotencyKey: randomUUID() }, response = await client.mutate("/api/products", body); assert.equal(response.status, 201, await response.clone().text()); return { pid: (await response.json()).ids[0] as string, body }; }
try {
    if (mode === "sqlite") {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    for (const [client, email] of [[admin, "admin"], [brand, "luna"], [team, "team"], [gsg, "operator"], [price, "price"], [foreign, "wave"]] as const)
        await client.login(`${email}@example.test`);
    check("anonymous list denied", (await new Client().send("/api/products")).status === 401, ["AC-06-04", "A19"]);
    check("CSRF mutation denied", (await brand.send("/api/products", "POST", {})).status === 403, ["A19"]);
    check("CR01 nonfinite page rejected", (await brand.send("/api/products?page=Infinity")).status === 422, ["G06-CR01"]);
    const minimum = await brand.mutate("/api/products", { contextId: A, brandId: "brand-luna", common: { name: "최소 HTTP 상품", code: "TMP-HTTP-001", temporaryCode: true }, idempotencyKey: randomUUID() });
    check("minimum three-value creation", minimum.status === 201, ["SA-24", "AC-06-01"]);
    const pid = (await minimum.json()).ids[0] as string;
    let d = await detail(brand, pid);
    check("unknown inputs remain unknown", d.common.temporaryCode && d.common.ingredients.classification === null && d.local.jan === "" && d.local.launchDate.value === null, ["SA-24"]);
    check("new product material counts connected with actual zero requests", d.materialCounts.connected && d.materialCounts.requested === 0 && d.materialCounts.missing === 0 && d.materialCounts.unconfirmed === 0, ["SA-22"]);
    const full = { ...blankCommon(), name: "HTTP 공개 상품 최신", code: "001-HTTP-A", localNames: [{ language: "ja", name: "合成現地名称" }], category: "합성 분류", capacity: { amount: "30.50", unit: "mL", raw: "30.50 mL" }, variants: { color: "합성 색", scent: "합성 향", other: "합성 변형" }, description: "합성 설명", usage: "합성 사용법", originCountry: "원문 원산지", manufacturer: "원문 제조사", manufacturingDetails: "제조 원문", ingredients: { text: "전성분 원문", language: "ko", submittedAt: "2026-09-21", classification: null }, packaging: { container: "용기", packaging: "포장", label: "라벨", box: "박스", itf: "00000111" } };
    const save = { contextId: A, command: "save_common", common: full, expectedCommonRevision: d.commonRevision, idempotencyKey: randomUUID() };
    const first = await brand.mutate(`/api/products/${pid}`, save), retry = await brand.mutate(`/api/products/${pid}`, save);
    check("same retry result stable", first.status === 200 && retry.status === 200 && hash(await first.json()) === hash(await retry.json()), ["AC-06-01", "A20"]);
    check("same key changed body conflict", (await brand.mutate(`/api/products/${pid}`, { ...save, common: { ...full, name: "changed retry" } })).status === 409, ["A20"]);
    d = await detail(brand, pid);
    check("all common nested fields roundtrip", hash(d.common) === hash({ ...full, capacity: { ...full.capacity, amount: "30.5" } }), ["SA-23", "SA-27"]);
    const originalB = (await brand.get<ProductList>(`/api/products?context=${B}`)).items.length;
    await command(brand, pid, "link_context", { targetContextId: B, expectedCommonRevision: d.commonRevision });
    check("explicit same product second-context relation", (await brand.get<ProductList>(`/api/products?context=${B}`)).items.length === originalB + 1, ["AC-06-02"]);
    const localA = { ...blankContext(), localName: "A 이름", sku: "000-A", jan: "00000011", registrationStatus: "registered", salesStatus: "planned", launchDate: { value: "2027-01-02T12:00:00+09:00", precision: "datetime", certainty: "expected", timezone: "Asia/Tokyo", source: "합성 일정", raw: "미확정 원문" } };
    await command(team, pid, "save_context", { fields: localA, expectedContextRevision: d.contextRevision });
    const b = await detail(brand, pid, B);
    await command(brand, pid, "save_context", { fields: { ...b.local, sku: "000-B", jan: "00000022", salesStatus: "selling" }, expectedContextRevision: b.contextRevision }, B);
    d = await detail(team, pid);
    check("non-assignee can edit local public fields", isDeepStrictEqual(d.local, localA), ["SA-25", "A19"]);
    check("local contexts remain independent", (await detail(brand, pid, B)).local.sku === "000-B", ["AC-06-02"]);
    const impact = await team.mutate(`/api/products/${pid}/impact`, { contextId: A, common: { ...d.common, name: "팀원 공통 수정" }, expectedCommonRevision: d.commonRevision }), impactBody = await impact.json() as ProductImpact;
    check("impact lists only permitted contexts", impact.status === 200 && impactBody.visibleContexts.length === 1 && impactBody.visibleContexts[0].id === A && !JSON.stringify(impactBody).includes(B) && !Object.hasOwn(impactBody, "total"), ["AC-06-04", "SA-28"]);
    await command(team, pid, "save_common", { common: { ...d.common, name: "팀원 공통 수정" }, expectedCommonRevision: d.commonRevision });
    check("common edit shared while private context remains inaccessible", (await detail(brand, pid, B)).common.name === "팀원 공통 수정" && (await team.send(`/api/products/${pid}?context=${B}`)).status === 404, ["AC-06-02", "AC-06-04"]);
    await command(brand, pid, "save_retail", { price: { ...blankRetailPrice(), amount: "0", currency: "JPY", taxIncluded: "yes", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }, expectedPriceRevision: 0 });
    await command(brand, pid, "save_retail", { price: { ...blankRetailPrice(), amount: "10000", currency: "KRW", effectiveFrom: "2027-01-01" }, expectedPriceRevision: 0 }, B);
    await command(price, pid, "save_internal", { price: { ...blankInternalPrice(), supplyAmount: privatePriceValue, currency: "JPY", supplyRate: "0.4", rateUnit: "ratio", rateBasis: "소비자가", source: "합성 내부 공급 조건" }, expectedPriceRevision: 0 });
    for (const [label, client] of [["brand", brand], ["nonprice-gsg", gsg], ["team", team]] as const) {
        const body = await detail(client, pid);
        check(`${label} has no private keys/history/version/value`, !Object.hasOwn(body, "internal") && !JSON.stringify(body).includes(privatePriceValue), ["AC-06-04"]);
        check(`${label} private search cannot affect count`, (await client.get<ProductList>(`/api/products?q=${privatePriceValue}`)).total === 0, ["AC-06-04"]);
    }
    check("price grant and decimal zero preserved", (await detail(price, pid)).internal!.current!.fields.supplyAmount === privatePriceValue && (await detail(brand, pid)).retail.current!.fields.amount === "0", ["SA-26"]);
    check("internal upload capability distinct from price", (await detail(gsg, pid)).capabilities.uploadInternalFile === true && (await detail(gsg, pid)).capabilities.editInternalPrice === false && (await detail(brand, pid)).capabilities.uploadInternalFile === false, ["AC-06-04"]);
    const uploaded = await team.upload(`productId=${pid}&contextId=${A}`, png);
    check("independent product multipart upload", uploaded.status === 201, ["SA-27"]);
    const file = (await uploaded.json()).files[0] as {
        id: string;
        sha256: string;
    };
    const binding = { ...blankFileBinding("http-doc", file.id), purpose: "image", title: "합성 SDS", documentType: "SDS", issuer: "합성 발행인", issuedAt: "2026-09-01", signedAt: "2026-09-02", validityRaw: "만료일 원문 없음", productIds: [pid], language: "ja", media: "리플렛", usePlace: "합성 매장", source: "제공 원문" };
    d = await detail(brand, pid);
    await command(brand, pid, "save_files", { files: [binding], expectedContextRevision: d.contextRevision });
    d = await detail(brand, pid);
    check("file metadata fields and exact version projected", d.files[0].documentType === "SDS" && d.files[0].statedValidTo === null && d.files[0].file.sha256 === file.sha256 && d.files[0].fileVersionId === file.id, ["SA-28"]);
    const uploadedRow = (await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A })).fileProvenance.find(f => f.id === file.id)!;
    check("product upload provenance current/history/image/reuse uses original uploader/time", uploadedRow.uploaderId === "user-team" && d.files[0].file.uploaderLabel === "브랜드 팀원" && d.files[0].file.uploadedAt === uploadedRow.createdAt && d.image?.uploaderLabel === "브랜드 팀원" && d.contextHistory.flatMap(h => h.files).filter(f => f.fileVersionId === file.id).every(f => f.file.uploadedAt === uploadedRow.createdAt && f.file.uploaderLabel === "브랜드 팀원") && d.reusableFiles.find(f => f.id === file.id)?.uploadedAt === uploadedRow.createdAt, ["AC-06-05", "U06-08"]);
    check("product file metadata omits raw uploader identity", ["uploaderId", "email", "user", "membership", "storageKey"].every(k => !Object.hasOwn(d.files[0].file, k)), ["AC-06-04", "U06-08"]);
    const download = await brand.send(d.files[0].file.originalUrl);
    check("authenticated private original bytes/no-store", download.status === 200 && download.headers.get("cache-control")!.includes("no-store") && createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex") === file.sha256, ["SA-27", "A19"]);
    check("same-brand other context has no implicit image/file", (await detail(brand, pid, B)).image === null && (await brand.send(`/api/files/${file.id}?productId=${pid}&contextId=${B}`)).status === 404, ["AC-06-04"]);
    check("foreign file unavailable", (await foreign.send(d.files[0].file.downloadUrl)).status === 404, ["AC-06-04"]);
    check("wrong file type rejected", (await brand.upload(`productId=${pid}&contextId=${A}`, png, "fake.exe")).status === 422, ["SA-27"]);
    check("11-file batch rejected", (await brand.upload(`productId=${pid}&contextId=${A}`, png, "synthetic.png", "image/png", "public", 11)).status === 422, ["SA-27"]);
    check("brand internal upload denied", (await brand.upload(`productId=${pid}&contextId=${A}`, png, "internal.png", "image/png", "internal")).status === 403, ["AC-06-04"]);
    const use = await fixture<{
        id: string;
        sha256: string;
        contentHash: string;
    }>({ action: "capture", token: brand.token, productId: pid, contextId: A });
    const oldUse = (await detail(brand, pid)).uses.find(u => u.id === use.id)!;
    check("stored prior-use fixture is visibly labelled and exact", oldUse.producer === "prior_use_fixture" && oldUse.retailPrice!.amount === "0" && oldUse.files[0].sha256 === file.sha256, ["AC-06-03", "D09"], "DB_FIXTURE");
    await command(brand, pid, "save_common", { common: { ...d.common, name: "스냅샷 이후 새 이름" }, expectedCommonRevision: d.commonRevision });
    d = await detail(brand, pid);
    await command(brand, pid, "save_context", { fields: { ...d.local, sku: "AFTER-SNAPSHOT" }, expectedContextRevision: d.contextRevision });
    const snapshotAfter = await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A });
    check("actual update API leaves old use byte-equivalent", snapshotAfter.uses.find(u => u.id === use.id)?.sha256 === use.sha256, ["AC-06-03", "D09"], "DB_FIXTURE");
    const beforePoison = await detail(brand, pid);
    await fixture({ action: "poison", token: admin.token, productId: pid, contextId: A });
    const rawBefore = await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A });
    for (const [label, client] of [["brand", brand], ["price", price], ["gsg", gsg]] as const) {
        const body = await detail(client, pid), list = await client.get<ProductList>(`/api/products?context=${A}`);
        writeFileSync(`${reportFile}.${label}-projected-private.json`, JSON.stringify({ body, list }, null, 2), { mode: 0o600 });
        check(`${label} actual API recursively omits persisted canary`, !JSON.stringify({ body, list }).includes(PRODUCT_CANARY), ["AC-06-04"]);
    }
    check("all legitimate common fields survive canary projection", hash((await detail(brand, pid)).common) === hash(beforePoison.common), ["SA-23"]);
    check("unknown canary search has zero matches", (await brand.get<ProductList>(`/api/products?q=${PRODUCT_CANARY}`)).total === 0, ["AC-06-04"]);
    const rawAfter = await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A });
    check("projection leaves original poisoned records untouched", rawBefore.canaryStored && rawAfter.canaryStored && rawBefore.sha256 === rawAfter.sha256, ["AC-06-04", "A20"], "DB_FIXTURE");
    d = await detail(brand, pid);
    const replayBody = { contextId: A, command: "save_common", common: d.common, expectedCommonRevision: d.commonRevision, idempotencyKey: randomUUID() };
    const receiptFixture = await fixture<{
        id: string;
        sha256: string;
    }>({ action: "receipt", token: brand.token, productId: pid, contextId: A, body: replayBody });
    const replay = await brand.mutate(`/api/products/${pid}`, replayBody);
    check("CR02 actual replay response projects IDs only", replay.status === 200 && JSON.stringify(await replay.json()) === JSON.stringify({ ids: [pid] }), ["G06-CR02"]);
    const receiptAfter = await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A });
    check("CR02 poisoned immutable receipt preserved", receiptAfter.receipts.find(r => r.id === receiptFixture.id)?.sha256 === receiptFixture.sha256, ["G06-CR02"], "DB_FIXTURE");
    const home = await brand.send(`/products?context=${A}`), html = await home.text();
    writeFileSync(`${reportFile}.legacy-products-private.html`, html, { mode: 0o600 });
    check("CR04 actual legacy product-card href carries selected context", home.status === 200 && html.includes(`/products/product-serum?context=${A}`) && !html.includes("context=null"), ["G06-CR04"]);
    check("actual legacy product-list SSR contains no private product marker/price", !html.includes(PRODUCT_CANARY) && !html.includes(privatePriceValue), ["AC-06-04"]);
    const taskContent = { ...blankContent(), title: "HTTP 상품 업무 연결", description: "실제 공개 연결", deadline: { ...blankContent().deadline, responsibleUserId: "user-gsg" }, requirements: [{ ...blankRequirement("text"), label: "요청 항목" }] };
    const taskCreated = await admin.mutate("/api/tasks", { targets: [{ contextId: A, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: [], productIds: [pid] }], content: taskContent, category: "spot", idempotencyKey: randomUUID() });
    check("actual G04 creation keeps Product ID", taskCreated.status === 201, ["AC-06-01"]);
    const tid = (await taskCreated.json()).ids[0] as string;
    const taskDetail = () => admin.get<TaskDetail>(`/api/tasks/${tid}`);
    const taskCommand = async (name: string, extra: Record<string, unknown> = {}) => { const r = await admin.mutate(`/api/tasks/${tid}`, { command: name, expectedRevision: (await taskDetail()).task.revision, idempotencyKey: randomUUID(), ...extra }); assert.equal(r.status, 200, await r.clone().text()); };
    await taskCommand("publish");
    const pending = await gsg.upload(`taskId=${tid}`, png), pendingFile = (await pending.json()).files[0] as {
        id: string;
    };
    d = await detail(brand, pid);
    const pendingBind = await brand.mutate(`/api/products/${pid}`, { contextId: A, command: "save_files", files: [blankFileBinding("pending", pendingFile.id)], expectedContextRevision: d.contextRevision, idempotencyKey: randomUUID() });
    check("CR03 direct known unpublished task-file binding denied", pending.status === 201 && pendingBind.status === 422 && (await brand.send(`/api/files/${pendingFile.id}?taskId=${tid}`)).status === 404, ["G06-CR03"]);
    await taskCommand("save", { content: { ...taskContent, referenceFileIds: [pendingFile.id, d.files[0].fileVersionId] } });
    await taskCommand("publish");
    const pd = await brand.get<TaskDetail>(`/api/tasks/${tid}`);
    check("G04 own draft publication plus product file reference work", pd.request!.referenceFileIds.includes(pendingFile.id) && pd.task.data.productIds.includes(pid), ["G06-CR03", "AC-06-01"]);
    const sharedDownload = await brand.send(`/api/files/${d.files[0].fileVersionId}?taskId=${tid}`);
    check("actual task reference reads exact product file", sharedDownload.status === 200 && createHash("sha256").update(Buffer.from(await sharedDownload.arrayBuffer())).digest("hex") === file.sha256, ["SA-27"]);
    const taskSource = (await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A })).fileProvenance.find(f => f.id === pendingFile.id)!;
    await command(brand, pid, "save_files", { files: [binding, blankFileBinding("published-task-file", pendingFile.id)], expectedContextRevision: (await detail(brand, pid)).contextRevision });
    d = await detail(brand, pid);
    const taskBinding = d.files.find(f => f.fileVersionId === pendingFile.id)!;
    check("existing published task file keeps original upload provenance in product/history", taskSource.uploaderId === "user-gsg" && taskBinding.file.uploaderLabel === "가상 운영자" && taskBinding.file.uploadedAt === taskSource.createdAt && d.contextHistory.flatMap(h => h.files).filter(f => f.fileVersionId === pendingFile.id).every(f => f.file.uploadedAt === taskSource.createdAt), ["AC-06-05", "U06-08"]);
    const second = await create(brand, "SECOND-HTTP");
    check("brand task link denied", (await brand.mutate(`/api/products/${second.pid}`, { contextId: A, command: "link_task", taskId: tid, expectedTaskRevision: pd.task.revision, idempotencyKey: randomUUID() })).status === 403, ["AC-06-04"]);
    await command(admin, second.pid, "link_task", { taskId: tid, expectedTaskRevision: pd.task.revision });
    check("existing task link persisted with stable IDs", (await taskDetail()).task.data.productIds.includes(second.pid), ["AC-06-01"]);
    let racer = brand;
    if (mode === "sqlite") {
        await start(auxPort);
        racer = new Client(auxPort);
        await racer.login("luna@example.test");
    }
    d = await detail(brand, pid);
    const races = await Promise.all([brand, racer].map((c, n) => c.mutate(`/api/products/${pid}`, { contextId: A, command: "save_common", common: { ...d.common, name: `Concurrent-${n}` }, expectedCommonRevision: d.commonRevision, idempotencyKey: randomUUID() })));
    check("concurrent CAS exactly one winner", races.map(r => r.status).sort().join(",") === "200,409", ["AC-06-01", "A20"]);
    const duplicate = await Promise.all([brand, racer].map((c, n) => c.mutate("/api/products", { contextId: A, brandId: "brand-luna", common: { name: "중복 경쟁", code: n ? "  race-code  " : "RACE-CODE" }, idempotencyKey: randomUUID() })));
    check("context-normalized code concurrent duplicate exactly one winner", duplicate.map(r => r.status).sort().join(",") === "201,409", ["SA-24", "A20"]);
    d = await detail(brand, pid);
    await command(brand, pid, "save_context", { fields: { ...d.local, salesStatus: "stopped" }, expectedContextRevision: d.contextRevision });
    await command(brand, pid, "archive", { expectedCommonRevision: (await detail(brand, pid)).commonRevision });
    d = await detail(brand, pid);
    check("archive and sales stop preserve tasks/files/versions/use", d.archived && d.local.salesStatus === "stopped" && d.linkedTasks.some(t => t.id === tid) && d.files.length > 0 && d.commonHistory.length > 1 && d.uses.some(u => u.id === use.id), ["AC-06-05"]);
    const beforeRestart = hash(d), privateBefore = hash((await detail(price, pid)).internal), snapshotBeforeRestart = await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A });
    if (mode === "sqlite") {
        await stop(auxPort);
        await stop(port);
        await start();
        const relogged = new Client();
        await relogged.login("luna@example.test");
        const priceRelogged = new Client();
        await priceRelogged.login("price@example.test");
        check("different actual server PID after restart", processes[0].pid !== processes.at(-1)!.pid, ["A20"], "PROCESS");
        check("restart and actual relogin preserve public product/all histories", hash(await detail(relogged, pid)) === beforeRestart, ["AC-06-01", "AC-06-03", "AC-06-05", "A20"]);
        check("restart preserves authorized private price history", hash((await detail(priceRelogged, pid)).internal) === privateBefore, ["SA-26", "A20"]);
        const restored = await relogged.send(d.files[0].file.originalUrl);
        check("restart preserves immutable original bytes", restored.status === 200 && createHash("sha256").update(Buffer.from(await restored.arrayBuffer())).digest("hex") === file.sha256, ["SA-27", "A20"]);
        check("restart leaves stored snapshot hashes unchanged", (await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A })).sha256 === snapshotBeforeRestart.sha256, ["AC-06-03", "A20"], "DB_FIXTURE");
    }
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
                status: string;
                scope: string;
                internalPriceAccess: boolean;
            };
        }[];
    }>(`/api/contexts/${A}/members`);
    const pm = members.members.find(m => m.data.userId === "user-price")!;
    const revoke = await admin.mutate(`/api/contexts/${A}/members/${pm.id}`, { expectedRevision: pm.revision, status: "active", scope: pm.data.scope, internalPriceAccess: false }, "PATCH");
    check("actual explicit price grant revoked", revoke.status === 200 && !("internal" in await detail(price, pid)), ["AC-06-04", "A19"]);
    const tm = members.members.find(m => m.data.userId === "user-team")!;
    const suspension = await admin.mutate(`/api/contexts/${A}/members/${tm.id}`, { expectedRevision: tm.revision, status: "suspended", scope: tm.data.scope, internalPriceAccess: false }, "PATCH");
    check("current membership suspension blocks product and original file", suspension.status === 200 && (await team.send(`/api/products/${pid}?context=${A}`)).status === 404 && (await team.send(d.files[0].file.downloadUrl)).status === 404, ["AC-06-04", "A19"]);
    const afterSuspension = await detail(brand, pid);
    check("suspended original uploader uses safe fallback throughout current and historical product files", afterSuspension.files.find(f => f.fileVersionId === file.id)?.file.uploaderLabel === "이전 업로더" && afterSuspension.image?.uploaderLabel === "이전 업로더" && afterSuspension.reusableFiles.find(f => f.id === file.id)?.uploaderLabel === "이전 업로더" && afterSuspension.contextHistory.flatMap(h => h.files).filter(f => f.fileVersionId === file.id).every(f => f.file.uploaderLabel === "이전 업로더" && f.file.uploadedAt === uploadedRow.createdAt), ["AC-06-05", "U06-08"]);
    const filesAfterSuspension = (await fixture<FixtureSnapshot>({ action: "snapshot", productId: pid, contextId: A })).fileProvenance;
    check("metadata edits/archive/revoke do not rewrite original product or task file rows", filesAfterSuspension.find(f => f.id === file.id)?.sha256 === uploadedRow.sha256 && filesAfterSuspension.find(f => f.id === pendingFile.id)?.sha256 === taskSource.sha256, ["AC-06-05", "U06-08"], "DB_FIXTURE");
}
catch (error) {
    failure = error instanceof Error ? error.message : "unknown failure";
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const report = { candidate_commit: candidate, runner_sha256: hash(readFileSync("scripts/verify-products-http.ts", "utf8")), fixture_runner_sha256: hash(readFileSync("scripts/verify-products-fixtures.ts", "utf8")), status: failure ? "FAIL" : "PASS", mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, unit: "assertion", pass: checks.filter(c => c.status === "PASS").length, fail: checks.filter(c => c.status === "FAIL").length, skip: 0, not_run: failure ? "later script assertions interrupted" : "none within this runner; browser/RSC and G05 actual producer remain NOT_RUN", checks, transcript, processes, resources: { primaryPort: port, auxPort, database, files }, fixture_boundary: "private direct repository/test-only mock IPC; actual G05 producer NOT_RUN", credentialsAndCookies: "memory only; not recorded" };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, reportFile }));
}
