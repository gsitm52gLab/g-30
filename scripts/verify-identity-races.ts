import assert from "node:assert/strict";
import { fork, type Serializable } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { IdentityService } from "@/server/auth/service";
import { DEMO_PASSWORD } from "@/domain/catalog";
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/g01-races-"));
const filename = path.join(directory, "races.db");
const db = openDatabase(filename, true);
migrate(db);
const repo = createSqliteRepository(db);
await seed(repo);
const service = new IdentityService(repo);
const admin = await service.login(undefined, { email: "admin@example.test", password: DEMO_PASSWORD });
type Result = {
    ok: boolean;
    code?: string;
    pid: number;
    result?: {
        token: string;
        userId: string;
    };
};
const processEvidence: Array<{
    pid?: number;
    command: string[];
    cwd: string;
    exitCode: number | null;
}> = [];
async function race(message: Serializable) {
    const children = [0, 1].map(() => fork("scripts/identity-race-worker.ts", [filename], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] }));
    await Promise.all(children.map(child => new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); })));
    const results = children.map(child => new Promise<Result>((resolve, reject) => { let value: Result; child.once("message", result => { value = result as Result; }); child.once("error", reject); child.once("exit", code => { processEvidence.push({ pid: child.pid, command: [process.execPath, "--import", "tsx", "scripts/identity-race-worker.ts", filename], cwd: process.cwd(), exitCode: code }); if (code !== 0 || !value)
        reject(new Error("Race worker failed"));
    else
        resolve(value); }); }));
    children.forEach(child => child.send(message));
    return Promise.all(results);
}
const invites = await race({ action: "invite", token: admin.token, input: { email: "race@example.test", name: "경합 합성", role: "brand" } });
assert.equal(invites.filter(r => r.ok).length, 1);
assert.equal(invites.find(r => !r.ok)?.code, "ALREADY_INVITED");
const winner = invites.find(r => r.ok)!.result!;
const accepts = await race({ action: "accept", input: { token: winner.token, password: DEMO_PASSWORD } });
assert.equal(accepts.filter(r => r.ok).length, 1);
assert.equal(accepts.find(r => !r.ok)?.code, "INVITATION_INVALID");
assert.equal((await repo.list("user")).filter(u => u.data.normalizedEmail === "race@example.test").length, 1);
assert.equal((await repo.list("membership", "ctx-jp-a-luna")).filter(m => m.data.userId === winner.userId).length, 1);
assert.equal((await repo.list("credential")).filter(c => c.data.userId === winner.userId).length, 1);
assert.equal((await repo.list("audit")).filter(a => a.data.action === "invitation.accepted").length, 1);
assert.equal(new Set(processEvidence.map(p => p.pid)).size, 4);
repo.close();
const report = { status: "PASS", passed: 9, failed: 0, skipped: 0, level: "implementer-self-check", checks: ["separate SQLite processes duplicate invite: 1 success + ALREADY_INVITED", "separate SQLite processes same token accept: 1 success + INVITATION_INVALID", "one identity/membership/credential/accept audit", "four distinct worker processes"], processes: processEvidence, secrets: "IPC memory only; not recorded" };
const destination = process.env.IDENTITY_RACES_REPORT || path.join(directory, "identity-races.json");
mkdirSync(path.dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, passed: 9, failed: 0, skipped: 0, report: path.resolve(destination) }));
