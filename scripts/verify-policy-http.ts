import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
const port = process.env.E2E_PORT || "4121";
const origin = `http://127.0.0.1:${port}`;
const cookieName = `gs_hale_g02_${port}`;
const root = path.resolve(process.env.EVIDENCE_ROOT || ".local/g02-evidence");
mkdirSync(root, { recursive: true });
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/g02-http-"));
const filename = path.join(directory, "policy.db");
const db = openDatabase(filename, true);
migrate(db);
const repo = createSqliteRepository(db);
await seed(repo);
const contextId = "ctx-jp-a-luna";
const marker = "G02_UNKNOWN_NESTED_CANARY";
const privateMarker = "G02_PRIVATE_ORIGINAL_CANARY";
await repo.transaction(async (s) => {
    const task = (await s.get("task", "task-onboarding"))!;
    (await s.update("task", task.id, task.revision, { ...task.data, internalOriginal: privateMarker, internalMemo: privateMarker,
        nestedUnknown: { value: marker } } as typeof task.data));
    const product = (await s.get("product", "product-serum"))!;
    (await s.update("product", product.id, product.revision, { ...product.data, internalSupplyPrice: "G02_PRIVATE_PRICE", nestedUnknown: { value: marker } } as typeof product.data));
    const admin = (await s.get("user", "user-admin"))!;
    (await s.update("user", admin.id, admin.revision, { ...admin.data, adminGrant: { ...admin.data.adminGrant!, unknown: { secret: marker } } } as typeof admin.data));
    (await s.create("membership", { id: "policy-peer-admin", contextId, data: { userId: admin.id, role: "operator", status: "active", scope: "합성 권한 검증", internalPriceAccess: false, activatedAt: new Date().toISOString(), suspendedAt: null } }));
    (await s.create("audit", { id: "policy-audit", contextId, data: { actorId: "user-admin", action: "membership.changed", targetId: "policy-peer-admin", before: { internalSupplyPrice: "G02_PRIVATE_PRICE", nested: { value: marker } }, after: { status: "active" }, at: new Date().toISOString() } }));
});
const checks: {
    id: string;
    requirement: string;
    level: string;
}[] = [];
const processes: {
    pid?: number;
    command: string[];
    cwd: string;
    exitCode?: number | null;
}[] = [];
let server: ChildProcess | undefined;
let failure: string | undefined;
function check(id: string, condition: boolean, requirement = "A19", level = "HTTP") {
    assert.equal(condition, true, id);
    checks.push({ id, requirement, level });
}
async function start(database = filename) {
    const args = ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port];
    server = spawn(process.execPath, args, { stdio: "ignore", env: { ...process.env,
            DATA_SOURCE: "sqlite", DATABASE_FILE: database, APP_ORIGIN: origin, SESSION_COOKIE_NAME: cookieName,
            OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
    processes.push({ pid: server.pid, command: [process.execPath, ...args], cwd: process.cwd() });
    for (let i = 0; i < 200; i++) {
        if (server.exitCode !== null)
            throw new Error("Owned server exited before ready");
        try {
            if ((await fetch(`${origin}/api/health`)).status === (database === filename ? 200 : 503))
                return;
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Owned server startup timeout");
}
async function stop() {
    if (!server)
        return;
    const owned = server;
    const done = new Promise<void>(resolve => owned.once("exit", () => resolve()));
    owned.kill("SIGTERM");
    if (owned.exitCode === null)
        await done;
    processes[processes.length - 1].exitCode = owned.exitCode;
    server = undefined;
}
class Client {
    cookie = "";
    setCookie = "";
    async send(url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
        const result = await fetch(`${origin}${url}`, { method, headers: { Cookie: this.cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
        const set = result.headers.get("set-cookie");
        if (set) {
            this.setCookie = set;
            this.cookie = set.split(";")[0];
        }
        return result;
    }
    async mutate(url: string, method: string, body: unknown, extra: Record<string, string> = {}) {
        const csrf = await (await this.send("/api/auth/csrf")).json();
        return this.send(url, method, body, { Origin: origin, "X-CSRF-Token": csrf.csrfToken, ...extra });
    }
    async login(email: string) {
        check(`login:${email}`, (await this.mutate("/api/auth/login", "POST", { email, password: DEMO_PASSWORD })).status === 200);
    }
}
const digestDomain = async () => {
    const values = await Promise.all([repo.list("context"), repo.list("user"), repo.list("membership"), repo.list("task"), repo.list("audit")]);
    return createHash("sha256").update(JSON.stringify(values)).digest("hex");
};
try {
    await start();
    const admin = new Client();
    await admin.login("admin@example.test");
    const selected = new Client();
    await selected.login("selected@example.test");
    const brand = new Client();
    await brand.login("luna@example.test");
    const team = new Client();
    await team.login("team@example.test");
    const operator = new Client();
    await operator.login("operator@example.test");
    check("self grant allowlist", !JSON.stringify(await (await admin.send("/api/auth/me")).json()).includes(marker), "AC-02-02");
    const peer = await (await selected.send(`/api/contexts/${contextId}/members`)).json();
    check("peer administrator has no grant", !Object.hasOwn(peer.members.find((m: {
        user: {
            id: string;
        };
    }) => m.user.id === "user-admin").user, "adminGrant"), "AC-02-02");
    check("current manager nested task/audit markers excluded", !JSON.stringify(peer).includes(marker) && !JSON.stringify(peer).includes("G02_PRIVATE_PRICE"), "AC-02-02");
    for (const client of [team, operator, selected]) {
        const foreign = await client.send("/api/contexts/ctx-jp-a-wave/members");
        const missing = await client.send("/api/contexts/absent-context/members");
        check(`foreign and absent same404:${[team, operator, selected].indexOf(client)}`, foreign.status === 404 && missing.status === 404 && await foreign.text() === await missing.text(), "AC-02-01");
    }
    for (const route of ["/", "/tasks", "/products", "/tasks/task-onboarding", "/products/product-serum", "/contexts"]) {
        for (const rsc of [false, true]) {
            // Next 16.3 validates the RSC cache-busting parameter, including an empty hash.
            const response = await brand.send(`${route}?context=${contextId}${rsc ? "&_rsc=" : ""}`, "GET", undefined, rsc ? { RSC: "1" } : {});
            const text = await response.text();
            check(`brand ${rsc ? "RSC" : "HTML"} ${route} status=${response.status} location=${response.headers.get("location")} marker=${text.includes(marker)} private=${text.includes(privateMarker)}`, response.status === 200 && !text.includes(marker) && !text.includes(privateMarker) && !text.includes("G02_PRIVATE_PRICE"), "AC-02-02", rsc ? "RSC" : "HTML");
        }
    }
    for (const url of ["/tasks/task-wave?context=ctx-jp-a-wave", "/products/product-balm?context=ctx-jp-a-luna", "/products/product-cream?context=ctx-sg-a-luna"]) {
        const response = await team.send(url);
        const text = await response.text();
        check(`foreign page:${url}`, !text.includes("샘플 패키지 자료 확인") && !text.includes("웨이브 립밤") && !text.includes("루나 모이스처 크림"), "AC-02-01", "HTML");
    }
    const before = await digestDomain();
    const unsafe: [
        string,
        string
    ][] = [
        ["/api/auth/login", "POST"], ["/api/auth/logout", "POST"], ["/api/invitations/accept", "POST"],
        ["/api/contexts", "POST"], [`/api/contexts/${contextId}/invitations`, "POST"], ["/api/invitations/missing/reissue", "POST"],
        ["/api/users/user-luna/status", "PATCH"], [`/api/contexts/${contextId}/members/member-user-luna-${contextId}`, "PATCH"],
        [`/api/contexts/${contextId}/reassignments`, "POST"],
    ];
    const csrf = await (await admin.send("/api/auth/csrf")).json();
    for (const [url, method] of unsafe) {
        for (const [label, headers] of Object.entries({ missingOrigin: { "X-CSRF-Token": csrf.csrfToken }, wrongOrigin: { Origin: "https://foreign.example", "X-CSRF-Token": csrf.csrfToken }, missingCsrf: { Origin: origin }, wrongCsrf: { Origin: origin, "X-CSRF-Token": "wrong" } })) {
            check(`CSRF ${method} ${url} ${label}`, (await admin.send(url, method, {}, headers as Record<string, string>)).status === 403);
        }
    }
    check("rejected unsafe requests make no domain/audit changes", await digestDomain() === before, "A20", "DB");
    check("brand cannot reassign", (await team.mutate(`/api/contexts/${contextId}/reassignments`, "POST", { taskId: "task-onboarding", toUserId: "user-team", expectedRevision: 1 })).status === 403, "AC-02-04");
    check("URL/resource context mismatch rejected", (await admin.mutate(`/api/contexts/${contextId}/reassignments`, "POST", { taskId: "task-wave", toUserId: "user-team", expectedRevision: 1 })).status === 404, "AC-02-01");
    check("forged actor input rejected", (await admin.mutate("/api/contexts", "POST", { type: "event", countryId: "JP", brandId: "brand-luna", eventName: "forged", actorId: "user-admin" })).status === 422, "AC-02-01");
    check("mutation failures still have no domain changes", await digestDomain() === before, "A20", "DB");
    const fixation = new Client();
    await fixation.send("/api/auth/csrf");
    const preauthCookie = fixation.cookie;
    await fixation.login("co@example.test");
    check("session rotated on login", fixation.cookie !== preauthCookie);
    check("HttpOnly SameSite path cookie", /httponly/i.test(fixation.setCookie) && /samesite=lax/i.test(fixation.setCookie) && /path=\//i.test(fixation.setCookie));
    check("HTTP origin cookie is not Secure", !/; secure/i.test(fixation.setCookie));
    const old = fixation.cookie;
    check("logout succeeds", (await fixation.mutate("/api/auth/logout", "POST", {})).status === 200);
    fixation.cookie = old;
    check("old cookie denied after logout", (await fixation.send("/api/auth/me")).status === 401);
    fixation.cookie = `${cookieName}=forged-role-admin`;
    check("forged cookie denied", (await fixation.send("/api/auth/me")).status === 401);
    const limited = new Client();
    check("oversize password before hash", (await limited.mutate("/api/auth/login", "POST", { email: "large@example.test", password: "x".repeat(129) })).status === 422);
    check("oversize body before hash", (await limited.mutate("/api/auth/login", "POST", { email: "large@example.test", password: "x".repeat(17000) })).status === 422);
    for (let attempt = 0; attempt < 20; attempt++) {
        check(`login rate counter:${attempt}`, (await limited.mutate("/api/auth/login", "POST", { email: "absent-policy@example.test", password: DEMO_PASSWORD }, { "X-Forwarded-For": `192.0.2.${attempt}` })).status === 401);
    }
    const throttle = await limited.mutate("/api/auth/login", "POST", { email: "absent-policy@example.test", password: DEMO_PASSWORD }, { "X-Forwarded-For": "203.0.113.99" });
    check("untrusted XFF cannot bypass persistent throttle and retry-after", throttle.status === 429 && Number(throttle.headers.get("retry-after")) > 0);
    for (let attempt = 0; attempt < 20; attempt++) {
        check(`invalid invitation rate counter:${attempt}`, (await limited.mutate("/api/invitations/accept", "POST", { token: "synthetic-invalid-invitation" }, { "X-Forwarded-For": `192.0.2.${attempt}` })).status === 410);
    }
    check("invalid invitation throttle", (await limited.mutate("/api/invitations/accept", "POST", { token: "synthetic-invalid-invitation" })).status === 429);
    const priceId = `member-user-price-${contextId}`;
    const priceBefore = (await repo.get("membership", priceId))!;
    check("actual price grant revoke", (await admin.mutate(`/api/contexts/${contextId}/members/${priceId}`, "PATCH", { expectedRevision: priceBefore.revision, status: "active", internalPriceAccess: false })).status === 200, "AC-02-05");
    const memberId = `member-user-luna-${contextId}`;
    const member = (await repo.get("membership", memberId))!;
    check("actual membership suspend", (await admin.mutate(`/api/contexts/${contextId}/members/${memberId}`, "PATCH", { expectedRevision: member.revision, status: "suspended" })).status === 200, "AC-02-05");
    const after = await (await brand.send("/api/auth/me")).json();
    check("same session loses only one context", after.contexts.length === 1 && after.contexts[0].id === "ctx-jp-b-luna", "AC-02-05");
    const deniedPage = await (await brand.send(`/tasks/task-onboarding?context=${contextId}`)).text();
    check("same session denied former task", !deniedPage.includes("신규 입점 상품 기본자료 준비"), "AC-02-05", "HTML");
    await stop();
    await start();
    check("two actual server processes", processes[0].pid !== processes[1].pid, "A20", "PROCESS");
    const relogin = new Client();
    await relogin.login("luna@example.test");
    check("membership persists on restart/relogin", (await (await relogin.send("/api/auth/me")).json()).contexts.length === 1, "AC-02-05");
    const pricing = new Client();
    await pricing.login("price@example.test");
    check("price revoke persists", (await (await pricing.send("/api/auth/me")).json()).memberships[0].data.internalPriceAccess === false, "AC-02-05");
    const retained = await (await admin.send(`/api/contexts/${contextId}/members`)).json();
    check("grant and suspension audit persists", retained.history.filter((a: {
        data: {
            action: string;
        };
    }) => a.data.action === "membership.changed").length >= 3, "AC-02-05", "DB");
    check("fresh sensitive response is no-store", (await brand.send("/api/auth/me")).headers.get("cache-control")?.includes("no-store") === true);
    const assets: string[] = [];
    function scan(dir: string) { for (const item of readdirSync(dir, { withFileTypes: true })) {
        const name = path.join(dir, item.name);
        if (item.isDirectory())
            scan(name);
        else if (item.name.endsWith(".js"))
            assets.push(name);
    } }
    scan(".next/static");
    const credentialDigests = (await repo.list("credential")).map(row => row.data.digest);
    check("client bundles exclude runtime markers and stored credential digests", assets.every(file => { const text = readFileSync(file, "utf8"); return !text.includes(marker) && !text.includes(privateMarker) && !text.includes("synthetic-policy-token-") && credentialDigests.every(digest => !text.includes(digest)); }), "A19", "ASSET");
    await stop();
    await start(path.join(directory, "missing", "unavailable.db"));
    check("store outage is 503 with no fallback", (await admin.send("/api/auth/me")).status === 503, "A20");
    const unavailable = await (await admin.send("/")).text();
    check("store outage page has no fixture", unavailable.includes("자료를 불러오지 못했습니다") && !unavailable.includes("신규 입점 상품 기본자료 준비"), "A20", "HTML");
}
catch (error) {
    failure = error instanceof Error ? error.message : "unknown failure";
}
finally {
    await stop();
    repo.close();
    const report = { status: failure ? "FAIL" : "PASS", level: "IMPLEMENTER_HTTP_DB_RSC", counts: { unit: "assertion", pass: checks.length, fail: failure ? 1 : 0, skip: 0, not_run: 0 },
        checks, failure, processes, cwd: process.cwd(), origin, cookieNamespace: cookieName,
        actualFileSearchExcelAiEndpoints: "NOT_IMPLEMENTED / D02-D05; covered separately by policy harness", secretCapture: "cookies, tokens and response bodies remain memory-only" };
    const reportPath = path.join(root, `policy-http-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, counts: report.counts, report: reportPath, failure }));
}
if (failure)
    process.exitCode = 1;
