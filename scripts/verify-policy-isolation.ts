import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";

const root = path.resolve(process.env.EVIDENCE_ROOT || ".local/g02-evidence");
mkdirSync(root, { recursive: true }); mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/g02-isolation-"));
const slots = [
    { port: 4121, cookie: "gs_hale_g02_4121" },
    { port: 4124, cookie: "gs_hale_g02_aux_4124" },
];
const processes: { port: number; cookie: string; pid?: number; cwd: string; command: string[]; exitCode?: number | null }[] = [];
const servers: ChildProcess[] = [];
const checks: string[] = [];
let failure: string | undefined;
function check(name: string, ok: boolean) { assert.equal(ok, true, name); checks.push(name); }
class Client {
    cookie = "";
    constructor(public port: number) { }
    async send(url: string, method = "GET", body?: unknown): Promise<Response> {
        const origin = `http://127.0.0.1:${this.port}`;
        const csrf = method !== "GET" ? await (await this.send("/api/auth/csrf")).json() : null;
        const response = await fetch(`${origin}${url}`, { method, headers: { Cookie: this.cookie,
            ...(csrf ? { Origin: origin, "X-CSRF-Token": csrf.csrfToken, "Content-Type": "application/json" } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
        const cookie = response.headers.get("set-cookie");
        if (cookie) this.cookie = cookie.split(";")[0];
        return response;
    }
}
try {
    for (const slot of slots) {
        const filename = path.join(directory, `slot-${slot.port}.db`);
        const db = openDatabase(filename, true); migrate(db);
        const repo = createSqliteRepository(db); await seed(repo); repo.close();
        const args = ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(slot.port)];
        const server = spawn(process.execPath, args, { stdio: "ignore", env: { ...process.env,
            APP_ORIGIN: `http://127.0.0.1:${slot.port}`, SESSION_COOKIE_NAME: slot.cookie,
            DATA_SOURCE: "sqlite", DATABASE_FILE: filename, OPENAI_API_KEY: "", OPENAI_MODEL: "", NEXT_TELEMETRY_DISABLED: "1" } });
        servers.push(server); processes.push({ ...slot, pid: server.pid, cwd: process.cwd(), command: [process.execPath, ...args] });
        let ready = false;
        for (let i = 0; i < 200; i++) {
            if (server.exitCode !== null) throw new Error("Owned isolation server exited");
            try { if ((await fetch(`http://127.0.0.1:${slot.port}/api/health`)).status === 200) { ready = true; break; } } catch { }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        check(`slot ${slot.port} ready`, ready);
    }
    const primary = new Client(4121); const auxiliary = new Client(4124);
    for (const client of [primary, auxiliary]) check(`login ${client.port}`, (await client.send("/api/auth/login", "POST", { email: "luna@example.test", password: DEMO_PASSWORD })).status === 200);
    const primaryCookie = primary.cookie; const auxiliaryCookie = auxiliary.cookie;
    check("separate cookie names", primaryCookie.startsWith("gs_hale_g02_4121=") && auxiliaryCookie.startsWith("gs_hale_g02_aux_4124="));
    auxiliary.cookie = primaryCookie;
    check("primary namespace rejected by auxiliary", (await auxiliary.send("/api/auth/me")).status === 401);
    auxiliary.cookie = primaryCookie.replace("gs_hale_g02_4121=", "gs_hale_g02_aux_4124=");
    check("renamed primary token rejected by independent auxiliary DB", (await auxiliary.send("/api/auth/me")).status === 401);
    auxiliary.cookie = auxiliaryCookie;
    primary.cookie = auxiliaryCookie;
    check("auxiliary namespace rejected by primary", (await primary.send("/api/auth/me")).status === 401);
    primary.cookie = primaryCookie;
    check("primary logout succeeds", (await primary.send("/api/auth/logout", "POST", {})).status === 200);
    check("auxiliary login unaffected by primary logout", (await auxiliary.send("/api/auth/me")).status === 200);
    primary.cookie = primaryCookie;
    check("old primary cookie remains revoked", (await primary.send("/api/auth/me")).status === 401);
} catch (error) { failure = error instanceof Error ? error.message : "unknown failure"; }
finally {
    await Promise.all(servers.map(async (server, i) => {
        const done = new Promise<void>(resolve => server.once("exit", () => resolve()));
        if (server.exitCode === null) { server.kill("SIGTERM"); await done; }
        processes[i].exitCode = server.exitCode;
    }));
    const reportPath = path.join(root, `policy-isolation-${Date.now()}.json`);
    const report = { status: failure ? "FAIL" : "PASS", requirements: ["A19", "G02-T13"],
        counts: { unit: "assertion", pass: checks.length, fail: failure ? 1 : 0, skip: 0, not_run: 0 }, checks, failure, processes,
        secrets: "real cookies/tokens retained only in memory; separate synthetic databases" };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, counts: report.counts, report: reportPath, failure }));
}
if (failure) process.exitCode = 1;
