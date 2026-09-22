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
const mode = process.env.NOTIFICATIONS_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("NOTIFICATIONS_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4233), auxPort = validPort(process.env.E2E_AUX_PORT, 4234);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.NOTIFICATIONS_ROOT ?? ".local/g13-notifications-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "notifications.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.NOTIFICATIONS_REPORT ?? path.join(directory, "report.json"));
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
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, IMPORT_STORAGE_DIR: path.join(directory, "imports"), APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g13_notifications_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
import type { ScheduleContent, ScheduleDetail, ScheduleList } from '@/server/scheduling/contracts';
import type { NotificationList, NotificationSync } from '@/server/notifications/contracts';
import type { CompletionWorkspace } from '@/server/completion/service';
import { localCalendarDay } from '@/domain/scheduling/calendar';
const contextId = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), co = new Client(), gsg = new Client();
const checksExpected = ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12', 'H13', 'H14', 'H15', 'H16', 'H17', 'H18', 'H19', 'H20', 'H21', 'H22', 'H23', 'H24', 'H25', 'H26', 'H27', 'H28'];
const skipped: string[] = [];
let reachedEnd = false;
const q = `?context=${contextId}`;
async function ids(response: Response, status = 200): Promise<string[]> { assert.equal(response.status, status, await response.clone().text()); return (await response.json()).ids; }
async function sync(client = brand) { const r = await client.mutate('/api/notifications/sync', { contextId }); assert.equal(r.status, 200, await r.clone().text()); return await r.json() as NotificationSync; }
const schedule = (id: string, client = admin) => client.get<ScheduleDetail>(`/api/schedule/${id}`);
const dueDay = localCalendarDay(new Date(Date.now() + 2 * 86400000).toISOString(), 'Asia/Seoul');
const publicContent = () => ({ ...blankContent(), title: 'G13 actual HTTP task ' + randomUUID().slice(0, 6), description: '공개 요청', requirements: [{ ...blankRequirement('answer'), label: '답변' }], deadline: { ...blankContent().deadline, value: dueDay, timezone: 'Asia/Seoul', certainty: 'requested' as const, responsibleUserId: 'user-gsg' }, internalOriginal: 'PRIVATE_G13_HTTP', internalMemo: 'PRIVATE_G13_HTTP' });
async function createTask(publish = true) { const taskId = (await ids(await admin.mutate('/api/tasks', { category: 'spot', content: publicContent(), targets: [{ contextId, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: ['product-serum'] }], idempotencyKey: randomUUID() }), 201))[0]; if (publish)
    await ids(await admin.mutate(`/api/tasks/${taskId}`, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() })); return taskId; }
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        (await repo.close());
    }
    await start();
    const anon = new Client();
    check('H01', (await anon.send('/api/notifications' + q)).status === 401, ['A19']);
    await admin.login('admin@example.test');
    await brand.login('luna@example.test');
    await co.login('co@example.test');
    await gsg.login('operator@example.test');
    check('H02', (await admin.get<NotificationList>('/api/notifications?context=ctx-empty')).total === 0, ['AC-13-02']);
    check('H03', (await brand.send('/api/notifications/sync', 'POST', { contextId })).status === 403 && (await brand.mutate('/api/notifications/sync', { contextId, userId: 'user-gsg' })).status === 422, ['A19']);
    const taskId = await createTask(false);
    check('H04', (await sync()).total === 0, ['AC-13-02']);
    await ids(await admin.mutate(`/api/tasks/${taskId}`, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }));
    const first = await sync();
    check('H05', first.items.length === 2 && first.items.filter(n => n.source.kind === 'event').length === 1 && first.items.filter(n => n.source.kind === 'reminder').length === 1 && first.items.every(n => n.email === 'not_connected'), ['AC-13-03', 'AC-13-05']);
    await Promise.all(Array.from({ length: 6 }, () => sync()));
    check('H06', (await brand.get<NotificationList>('/api/notifications' + q)).items.length === 2, ['AC-13-03']);
    const material = first.items[0], readIntent = { read: true, expectedRevision: material.revision, idempotencyKey: randomUUID() };
    await ids(await brand.mutate(`/api/notifications/${material.id}/read`, readIntent));
    await ids(await brand.mutate(`/api/notifications/${material.id}/read`, readIntent));
    check('H07', (await brand.get<NotificationList>('/api/notifications' + q)).unread === 1 && (await co.mutate(`/api/notifications/${material.id}/read`, readIntent)).status === 404, ['A19', 'AC-13-03']);
    check('H08', (await brand.mutate(`/api/notifications/${material.id}/read`, { ...readIntent, read: false, idempotencyKey: randomUUID() })).status === 409, ['AC-13-03']);
    await ids(await brand.mutate(`/api/notifications/${material.id}/read`, { read: false, expectedRevision: material.revision + 1, idempotencyKey: randomUUID() }));
    const content: ScheduleContent = { taskId, title: 'G13 실제 발송 확인', kind: 'shipping', visibility: 'public', deadline: { ...publicContent().deadline, responsibleUserId: 'user-luna' }, statements: [{ id: 'a', raw: ' 원문 날짜 ', source: '합성 외부 요청', version: 'v1', locator: 'p1' }], conflicts: [] };
    const intent = { command: 'save', contextId, scheduleId: null, expectedRevision: 0, content, idempotencyKey: randomUUID() }, created = await ids(await admin.mutate('/api/schedule', intent)), id = created[0];
    check('H09', (await ids(await admin.mutate('/api/schedule', intent)))[0] === id && (await schedule(id)).versions.length === 1, ['AC-13-01', 'AC-13-03']);
    check('H10', (await brand.mutate('/api/schedule', { ...intent, idempotencyKey: randomUUID() })).status === 403 && (await admin.mutate('/api/schedule', { ...intent, content: { ...content, deadline: { ...content.deadline, value: '2026-02-30' } }, idempotencyKey: randomUUID() })).status === 422, ['AC-13-01', 'A19']);
    const cal = (await brand.get<ScheduleList>('/api/schedule' + q)).items.find(r => r.logicalKey === `manual:${id}`)!;
    check('H11', cal.recipientPolicy === 'explicit_action_owner' && cal.actionOwners[0]?.id === 'user-luna' && cal.confirmationParty.id === 'user-luna' && cal.reminder.eligible && cal.deadline.certainty === 'requested', ['AC-13-01', 'SA-52']);
    await sync();
    check('H12', (await brand.get<NotificationList>('/api/notifications' + q)).items.filter(n => n.source.kind === 'reminder' && n.source.logicalKey === `manual:${id}`).length === 1, ['SA-52']);
    let detail = await schedule(id);
    const firstVersion = detail.versions[0];
    const conflict = { ...content, statements: [...content.statements, { id: 'b', raw: '다른 날짜 원문', source: '기관 확인', version: 'v2', locator: 'p2' }], conflicts: [{ id: 'dates', statementIds: ['a', 'b'], state: 'unresolved' as const, resolution: '' }] };
    await ids(await admin.mutate('/api/schedule', { ...intent, scheduleId: id, expectedRevision: detail.revision, content: conflict, idempotencyKey: randomUUID() }));
    detail = await schedule(id);
    check('H13', detail.versions.length === 2 && hash(detail.versions.at(-1)) === hash(firstVersion) && !detail.calendar.reminder.eligible && detail.current.content.statements[0].raw === ' 원문 날짜 ', ['AC-13-01']);
    check('H14', (await admin.mutate('/api/schedule', { ...intent, scheduleId: id, expectedRevision: 2, idempotencyKey: randomUUID() })).status === 409, ['AC-13-01']);
    await ids(await admin.mutate('/api/schedule', { command: 'cancel', contextId, scheduleId: id, expectedRevision: detail.revision, reason: '일정 취소', idempotencyKey: randomUUID() }));
    detail = await schedule(id);
    check('H15', detail.current.state === 'cancelled' && !detail.calendar.reminder.eligible, ['AC-13-04']);
    await ids(await admin.mutate('/api/schedule', { command: 'reopen', contextId, scheduleId: id, expectedRevision: detail.revision, reason: '다시 확인', idempotencyKey: randomUUID() }));
    detail = await schedule(id);
    const internal = { ...content, visibility: 'internal' as const, title: 'PRIVATE_G13_SCHEDULE' };
    await ids(await admin.mutate('/api/schedule', { ...intent, scheduleId: id, expectedRevision: detail.revision, content: internal, idempotencyKey: randomUUID() }));
    check('H16', (await brand.send(`/api/schedule/${id}`)).status === 404 && !JSON.stringify(await brand.get('/api/schedule' + q)).includes('PRIVATE_G13_') && !(await brand.get<NotificationList>('/api/notifications' + q)).items.some(n => n.title === 'G13 실제 발송 확인'), ['A19']);
    const taskDetail = await admin.get<TaskDetail>(`/api/tasks/${taskId}`);
    check('H17', taskDetail.activities.length === 0 && !(await brand.get<NotificationList>('/api/notifications' + q)).items.some(n => JSON.stringify(n).includes('PRIVATE_G13_HTTP')), ['AC-13-02', 'A19']);
    await ids(await brand.mutate(`/api/tasks/${taskId}`, { command: 'schedule', expectedRevision: taskDetail.task.revision, reason: '실제 일정 조정', deadline: { ...content.deadline, value: dueDay }, idempotencyKey: randomUUID() }));
    const ownerAlerts = await sync(gsg);
    check('H28', ownerAlerts.items.filter(n => n.actionUrl.includes(taskId) && n.message === '일정 조정 요청을 확인해 주세요.').length === 1, ['AC-13-02', 'SA-52']);
    const w = await admin.get<CompletionWorkspace>(`/api/completion?taskId=${taskId}`);
    await ids(await admin.mutate('/api/completion', { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: '', idempotencyKey: randomUUID() }));
    const taskRow = (await brand.get<ScheduleList>('/api/schedule' + q)).items.find(r => r.source.kind === 'task_request' && r.taskId === taskId)!;
    check('H18', !taskRow.reminder.eligible && taskRow.actionOwners.map(x => x.id).sort().join(',') === 'user-co,user-luna', ['AC-13-04']);
    if (mode === 'sqlite') {
        const raceTask = await createTask();
        await start(auxPort);
        const other = new Client(auxPort);
        await other.login('luna@example.test');
        const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => sync(i % 2 ? brand : other)));
        check('H19', replies.every(r => r.failed === 0), ['AC-13-03'], 'PROCESS');
        let db = openDatabase(database);
        const stored = db.prepare("SELECT kind,data FROM records WHERE kind IN ('notification','notificationReceipt')").all() as {
            kind: string;
            data: string;
        }[];
        const events = db.prepare("SELECT id FROM records WHERE kind='domainEvent' AND json_extract(data,'$.targetId')=? AND json_extract(data,'$.eventType')='TASK_PUBLISHED'").all(raceTask) as {
            id: string;
        }[];
        check('H20', events.length === 1 && stored.filter(r => r.kind === 'notification' && JSON.parse(r.data).source.eventId === events[0].id && JSON.parse(r.data).recipientId === 'user-luna').length === 1 && stored.filter(r => r.kind === 'notificationReceipt' && JSON.parse(r.data).source.eventId === events[0].id && JSON.parse(r.data).recipientId === 'user-luna').length === 1, ['AC-13-03'], 'DB_FIXTURE');
        db.close();
        await stop(auxPort);
        const faultTask = await createTask();
        db = openDatabase(database);
        const before = db.prepare("SELECT count(*) n FROM records WHERE kind='notification'").get() as {
            n: number;
        };
        db.exec("CREATE TRIGGER g13_test_notification_fault BEFORE INSERT ON records WHEN NEW.kind='notification' BEGIN SELECT RAISE(ABORT,'synthetic ownedDB delivery fault'); END;");
        db.close();
        const failed = await sync();
        check('H21', failed.failed === 2 && failed.failures.length === 2, ['AC-13-03']);
        db = openDatabase(database);
        check('H22', (db.prepare("SELECT count(*) n FROM records WHERE kind='notification'").get() as {
            n: number;
        }).n === before.n, ['AC-13-03'], 'DB_FIXTURE');
        db.exec('DROP TRIGGER g13_test_notification_fault');
        db.close();
        const retried = [];
        for (const f of failed.failures) {
            const response = await brand.mutate(`/api/notifications/attempts/${f.id}/retry`, {});
            assert.equal(response.status, 200);
            retried.push((await response.json()).state);
            const replay = await brand.mutate(`/api/notifications/attempts/${f.id}/retry`, {});
            assert.equal(replay.status, 200);
            retried.push((await replay.json()).state);
        }
        check('H23', retried.join(',') === 'delivered,reused,delivered,reused', ['AC-13-03']);
        check('H24', (await brand.get<NotificationList>('/api/notifications' + q)).failures.length === 0 && !!faultTask, ['AC-13-03']);
        const prior = { schedule: await schedule(id), notifications: await brand.get<NotificationList>('/api/notifications' + q) }, beforePid = processes[0].pid;
        await stop(port);
        await start();
        await brand.login('luna@example.test');
        await admin.login('admin@example.test');
        check('H25', processes.at(-1)!.pid !== beforePid && hash({ schedule: await schedule(id), notifications: await brand.get<NotificationList>('/api/notifications' + q) }) === hash(prior), ['AC-13-01', 'AC-13-03'], 'PROCESS');
    }
    else
        skipped.push('H19', 'H20', 'H21', 'H22', 'H23', 'H24', 'H25');
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
            };
        }[];
    }>(`/api/contexts/${contextId}/members`), member = members.members.find(m => m.data.userId === 'user-luna')!;
    assert.equal((await admin.mutate(`/api/contexts/${contextId}/members/${member.id}`, { expectedRevision: member.revision, status: 'suspended' }, 'PATCH')).status, 200);
    check('H26', (await brand.send('/api/notifications' + q)).status === 404 && (await brand.mutate('/api/notifications/sync', { contextId })).status === 404, ['A19']);
    check('H27', (await brand.mutate(`/api/notifications/${material.id}/read`, { read: true, expectedRevision: 1, idempotencyKey: randomUUID() })).status === 404, ['A19']);
    reachedEnd = true;
}
catch (error) {
    failure = error instanceof Error ? error.stack : 'unknown failure';
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    const notRun = checksExpected.filter(id => !checks.some(c => c.id === id) && !skipped.includes(id));
    const report = { candidate_commit: candidate, implementer_session_id: '01a0c307-c975-75b1-b96a-5a5c4e448aec', runner_sha256: hash(readFileSync('scripts/verify-notifications-http.ts', 'utf8')), status: failure ? 'FAIL' : 'PASS', mode, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), failure, count_unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, execution_failure: failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0, skip: skipped.length, skipped, not_run: notRun, reachedEnd, checks, transcript, processes, resources: { port, auxPort, database, files }, scope: 'Normal production Next start in both modes; actual HTTP synthetic producers; SQLite ownedDB fault trigger explicit test only, removed; no mocked API response. UI/provider/independent NOT_RUN.' };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, execution_failure: report.execution_failure, reportFile }));
}
