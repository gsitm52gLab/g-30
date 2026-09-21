import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
// Real HTTP cookies remain in memory only. No credential/token/DB snapshots are written.
const port = process.env.E2E_PORT || "4111";
const origin = `http://127.0.0.1:${port}`;
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/g01-restart-"));
const filename = path.join(directory, "identity.db");
const db = openDatabase(filename, true);
migrate(db);
const repo = createSqliteRepository(db);
await seed(repo);
repo.close();
let server: ChildProcess | undefined;
const processes: Array<{
    pid: number | undefined;
    command: string[];
    cwd: string;
    exitCode?: number | null;
}> = [];
const checks: string[] = [];
function check(name: string, condition: boolean) { assert.equal(condition, true, name); checks.push(name); }
async function start() {
    const args = ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port];
    server = spawn(process.execPath, args, { stdio: "pipe", env: { ...process.env, DATA_SOURCE: "sqlite", DATABASE_FILE: filename, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_restart_${port}`, OPENAI_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" } });
    server.stdout?.resume();
    server.stderr?.resume();
    processes.push({ pid: server.pid, command: [process.execPath, ...args], cwd: process.cwd() });
    for (let i = 0; i < 200; i++) {
        if (server.exitCode !== null)
            throw new Error("Owned identity server exited before ready");
        try {
            if ((await fetch(`${origin}/api/health`)).status === 200)
                return;
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Owned identity server did not become ready");
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
    async send(url: string, method = "GET", body?: unknown, csrf?: string) {
        const response = await fetch(`${origin}${url}`, { method, headers: { Cookie: this.cookie, ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": csrf || "" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
        const set = response.headers.get("set-cookie");
        if (set)
            this.cookie = set.split(";")[0];
        return response;
    }
    async mutate(url: string, method: string, body: unknown) {
        const csrf = await (await this.send("/api/auth/csrf")).json();
        return this.send(url, method, body, csrf.csrfToken);
    }
    async login(email: string) {
        const response = await this.mutate("/api/auth/login", "POST", { email, password: DEMO_PASSWORD });
        check(`login:${email}`, response.status === 200);
    }
}
try {
    await start();
    const admin = new Client();
    await admin.login("admin@example.test");
    const oldBrand = new Client();
    await oldBrand.login("luna@example.test");
    const newEmail = "restart-new@example.test";
    const pendingEmail = "restart-pending@example.test";
    const invResponse = await admin.mutate("/api/contexts/ctx-jp-a-luna/invitations", "POST", { email: newEmail, name: "재시작 사용자", role: "brand" });
    check("new invitation persisted before activation", invResponse.status === 201);
    const invitation = await invResponse.json();
    const pendingResponse = await admin.mutate("/api/contexts/ctx-jp-b-luna/invitations", "POST", { email: pendingEmail, name: "재시작 대기", role: "brand" });
    check("second pending invitation created", pendingResponse.status === 201);
    const pending = await pendingResponse.json();
    const invited = new Client();
    check("new account accepts invitation", (await invited.mutate("/api/invitations/accept", "POST", { token: invitation.token, password: DEMO_PASSWORD })).status === 200);
    await invited.login(newEmail);
    const before = await (await admin.send("/api/contexts/ctx-jp-a-luna/members")).json();
    const luna = before.members.find((m: {
        user: {
            id: string;
        };
    }) => m.user.id === "user-luna");
    const task = before.tasks.find((t: {
        id: string;
    }) => t.id === "task-onboarding");
    check("brand reassignment commits", (await admin.mutate("/api/contexts/ctx-jp-a-luna/reassignments", "POST", { taskId: task.id, toUserId: "user-co", expectedRevision: task.revision })).status === 200);
    check("global suspension commits", (await admin.mutate("/api/users/user-luna/status", "PATCH", { expectedRevision: luna.user.revision, status: "suspended" })).status === 200);
    check("old session denied before restart", (await oldBrand.send("/api/auth/me")).status === 401);
    const priorAdminCookie = admin.cookie;
    await stop();
    await start();
    check("different actual server process", processes[0].pid !== processes[1].pid);
    check("active session survives actual process restart", (await invited.send("/api/auth/me")).status === 200);
    check("revoked session remains denied after restart", (await oldBrand.send("/api/auth/me")).status === 401);
    check("admin session survives restart", (await admin.send("/api/auth/me")).status === 200 && admin.cookie === priorAdminCookie);
    const newLogin = new Client();
    await newLogin.login(newEmail);
    const me = await (await newLogin.send("/api/auth/me")).json();
    check("new identity and membership preserved", me.user.email === newEmail && me.contexts.length === 1 && me.contexts[0].id === "ctx-jp-a-luna");
    check("pending invitation remains usable after restart", (await new Client().mutate("/api/invitations/accept", "POST", { token: pending.token, password: DEMO_PASSWORD })).status === 200);
    check("consumed invitation remains unusable", (await new Client().mutate("/api/invitations/accept", "POST", { token: invitation.token, password: DEMO_PASSWORD })).status === 410);
    const after = await (await admin.send("/api/contexts/ctx-jp-a-luna/members")).json();
    const current = after.tasks.find((t: {
        id: string;
    }) => t.id === "task-onboarding");
    check("current assignee and original author preserved", current.data.assigneeId === "user-co" && current.data.authorId === "user-luna");
    check("audit survives restart", after.history.some((a: {
        data: {
            action: string;
        };
    }) => a.data.action === "task.reassigned") && after.history.some((a: {
        data: {
            action: string;
        };
    }) => a.data.action === "user.status"));
    const stopped = after.members.find((m: {
        user: {
            id: string;
        };
    }) => m.user.id === "user-luna");
    check("reactivation commits", (await admin.mutate("/api/users/user-luna/status", "PATCH", { expectedRevision: stopped.user.revision, status: "active" })).status === 200);
    check("reactivation does not revive old cookie", (await oldBrand.send("/api/auth/me")).status === 401);
    await new Client().login("luna@example.test");
    const inspect = createSqliteRepository(openDatabase(filename));
    await seed(inspect);
    check("idempotent seed preserves changed assignment", (await inspect.get("task", "task-onboarding"))?.data.assigneeId === "user-co");
    check("one new identity and one credential", (await inspect.list("user")).filter(u => u.data.email === newEmail).length === 1 && (await inspect.list("credential")).filter(c => c.data.userId === me.user.id).length === 1);
    inspect.close();
}
finally {
    await stop();
}
const report = { status: "PASS", level: "implementer-self-check", passed: checks.length, failed: 0, skipped: 0, checks, processes, processRestart: true, cookiesAndTokens: "memory only; not recorded", fixture: "synthetic-g01-v1" };
const destination = process.env.IDENTITY_RESTART_REPORT || path.join(directory, "identity-restart.json");
mkdirSync(path.dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: 0, skipped: 0, report: path.resolve(destination) }));
