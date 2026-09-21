import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, createWriteStream } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createMockRepository } from "@/server/repositories/mock";
import type { RecordRepository } from "@/domain/records";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
import { blankContent, blankRequirement, requirementTypes } from "@/domain/tasks/types";
import type { TaskDetail, TaskCatalog } from "@/server/tasks/service";
const projectionMarker="V03_HTTP_PRIVATE_EXTENSION", projectionTask="v03-http-task";
function projectionContent() {
    const d={...blankContent().deadline,value:"2026-12-03",responsibleUserId:"user-gsg",source:"공개 원문",sourceVersion:"source-v3",raw:"원문 유지"};
    return {...blankContent(),title:"V03 공개 제목",description:"V03 공개 설명",purpose:"공개 목적",output:"공개 결과",productionResponsibility:"브랜드",subtitleResponsibility:"GSG 확인",originalResponsibility:"브랜드 원본",usePlace:"공개 장소",nextAction:"공개 다음 행동",deadline:d,
        internalOriginal:"V03_LEGITIMATE_INTERNAL",internalMemo:"허용 내부 메모",requirements:[{...blankRequirement("v03-text"),label:"공개 항목",specifications:[{text:"공개 규격",source:"규격 출처",version:"spec-v3",severity:"recommended" as const,check:"human" as const}]}],milestones:[{id:"v03-print",kind:"printing_delivery" as const,visibility:"public" as const,counterpart:"공개 확인 상대",deadline:d}],links:[{url:"https://example.test/v03",description:"공개 링크",contentFixed:false as const}]};
}
function poison<T>(value:T):T { if(Array.isArray(value))return value.map(poison) as T; if(value&&typeof value==="object")return Object.assign(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,poison(v)])),{privateExtension:{deep:projectionMarker}}) as T;return value; }
async function prepareProjectionFixture(repo:RecordRepository) {
    const c=Object.assign(poison(projectionContent()),{internalSupplyPrice:projectionMarker,unknownObject:{deep:projectionMarker}}),contextId="ctx-jp-a-luna",at=new Date().toISOString();
    await repo.transaction(s=>{
        s.create("task",{id:projectionTask,contextId,data:{schemaVersion:2,visibility:"public",title:c.title,description:c.description,category:"spot",status:"requested",ownerId:"user-gsg",assigneeId:"user-luna",coAssigneeIds:[],productIds:[],deadline:c.deadline.value,nextAction:c.nextAction,notes:[],authorId:"user-admin",draft:c,currentRequestId:null,projectId:null}});
        s.create("requestVersion",{id:"v03-http-old",contextId,data:{taskId:projectionTask,sequence:1,previousId:null,templateVersionId:null,content:c,publishedBy:"user-admin",publishedAt:at,changedKeys:["v03-text",{private:projectionMarker}] as unknown as string[]}});
        const row=s.get("task",projectionTask)!;s.update("task",row.id,row.revision,{...row.data,currentRequestId:"v03-http-old"});
        s.create("templateVersion",{id:"v03-http-template",contextId,data:Object.assign({templateId:"v03-http-template",name:"V03 합성 템플릿",sequence:1,previousId:null,content:c,createdBy:"user-admin",builtin:false},{privateExtension:projectionMarker})});
        s.create("taskActivity",{id:"v03-http-activity",contextId,data:Object.assign({taskId:projectionTask,requestId:"v03-http-old",userId:"user-luna",kind:"schedule" as const,at,sequence:1,reason:"공개 조정 사유",proposedDeadline:poison(c.deadline),respondsTo:null,decision:null,resultingRequestId:null},{privateExtension:projectionMarker})});
        s.create("project",{id:"v03-http-project",contextId,data:Object.assign({title:"V03 공개 프로젝트",taskIds:[projectionTask,"task-onboarding"],dependencies:[Object.assign({before:projectionTask,after:"task-onboarding"},{privateExtension:projectionMarker})],status:"active" as const,createdBy:"user-admin"},{privateExtension:projectionMarker})});
    });
}
async function projectionSnapshot(repo:RecordRepository) {
    const values=await Promise.all([repo.get("task",projectionTask),repo.list("requestVersion").then(r=>r.filter(x=>x.data.taskId===projectionTask)),repo.list("taskActivity").then(r=>r.filter(x=>x.data.taskId===projectionTask)),repo.get("templateVersion","v03-http-template"),repo.get("project","v03-http-project")]);
    const serialized=JSON.stringify(values);return {sha256:createHash("sha256").update(serialized).digest("hex"),extensionStillStored:serialized.includes(projectionMarker)};
}
// Test-only process bootstrap: reuse the existing repository-cache contract without a product endpoint or source hook.
if(process.argv.includes("--projection-mock-server")) {
    const repo=createMockRepository();await seed(repo);await prepareProjectionFixture(repo);
    (globalThis as typeof globalThis & {gsHaleRepository?:{key:string;pending:Promise<RecordRepository>}}).gsHaleRepository={key:`mock:${process.env.DATABASE_FILE}`,pending:Promise.resolve(repo)};
    process.on("message",async message=>{const m=message as {kind?:string;id?:string};if(m.kind==="projection-snapshot")process.send?.({id:m.id,...await projectionSnapshot(repo)});});
    const {startServer}=await import("next/dist/server/lib/start-server.js");await startServer({dir:process.cwd(),hostname:"127.0.0.1",port:Number(process.env.E2E_PORT),isDev:false,allowRetry:false});
    await new Promise<never>(()=>{});
}
const projectionEnabled=process.env.TASKS_PROJECTION_FIXTURE==="1";
const mode = process.env.TASKS_MODE === "mock" ? "mock" : "sqlite";
const port = process.env.E2E_PORT || "4144", origin = `http://127.0.0.1:${port}`;
mkdirSync(".data", { recursive: true });
const directory = mkdtempSync(path.resolve(`.data/g04-http-${mode}-`));
const filename = path.join(directory, "tasks.db"), files = path.join(directory, "files");
const reportFile = process.env.TASKS_HTTP_REPORT || path.join(directory, "http-report.json");
mkdirSync(path.dirname(reportFile), { recursive: true });
if (mode === "sqlite") { const db = openDatabase(filename, true); migrate(db); const repo = createSqliteRepository(db); await seed(repo); if(projectionEnabled)await prepareProjectionFixture(repo); repo.close(); }
let server: ChildProcess | undefined;
const processes: { pid?: number; command: string[]; cwd: string; exitCode?: number | null; log: string }[] = [];
const checks: { id: string; requirements: string[]; status: "PASS" | "FAIL"; unit: "assertion" }[] = [];
let failure: string | undefined;
function check(id: string, condition: boolean, requirements = ["AC-04-02"]) { checks.push({ id, requirements, status: condition ? "PASS" : "FAIL", unit: "assertion" }); assert.equal(condition, true, id); }
async function start() {
    const args = mode==="mock"&&projectionEnabled ? ["--import","tsx","scripts/verify-tasks-http.ts","--projection-mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    server = spawn(process.execPath, args, { stdio: ["pipe","pipe","pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: filename, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g04_http_${port}`, OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", E2E_PORT:port, NEXT_TELEMETRY_DISABLED: "1" } });
    server.stdout?.pipe(output, { end: false }); server.stderr?.pipe(output, { end: false }); server.once("exit", () => output.end());
    processes.push({ pid: server.pid, command: [process.execPath, ...args], cwd: process.cwd(), log });
    for (let i = 0; i < 200; i++) { if (server.exitCode !== null) throw new Error("Owned G04 server exited"); try { if ((await fetch(`${origin}/api/health`)).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw new Error("Owned G04 server readiness timeout");
}
async function stop() { if (!server) return; const own = server, done = new Promise<void>(r => own.once("exit", () => r())); own.kill("SIGTERM"); if (own.exitCode === null) await done; processes.at(-1)!.exitCode = own.exitCode; server = undefined; }
async function storedProjectionSnapshot() {
    if(mode==="sqlite"){const repo=createSqliteRepository(openDatabase(filename));try{return await projectionSnapshot(repo);}finally{repo.close();}}
    return new Promise<{sha256:string;extensionStillStored:boolean}>((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>reject(new Error("Mock snapshot IPC timeout")),5000);server!.once("message",message=>{clearTimeout(timer);const m=message as {id:string;sha256:string;extensionStillStored:boolean};if(m.id!==id)reject(new Error("Snapshot IPC identity mismatch"));else resolve(m);});server!.send({kind:"projection-snapshot",id});});
}
class Client {
    cookie = "";
    async send(url: string, method = "GET", body?: unknown, csrf?: string) {
        const response = await fetch(`${origin}${url}`, { method, redirect: "manual", headers: { Cookie: this.cookie, ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": csrf || "" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        const set = response.headers.get("set-cookie"); if (set) this.cookie = set.split(";")[0]; return response;
    }
    async mutate(url: string, body: unknown, method = "POST") { const csrf = await (await this.send("/api/auth/csrf")).json(); return this.send(url, method, body, csrf.csrfToken); }
    async json<T>(url: string): Promise<T> { const r = await this.send(url); check(`GET ${url.split("?")[0]}`, r.status === 200); return r.json(); }
    async login(email: string) { check(`actual login ${email}`, (await this.mutate("/api/auth/login", { email, password: DEMO_PASSWORD })).status === 200, ["A19"]); }
    async upload(taskId: string, bytes: Buffer, name = "참고.pdf") { const csrf = await (await this.send("/api/auth/csrf")).json(); const body = new FormData(); body.append("files", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), name); body.append("visibility", "public"); return fetch(`${origin}/api/files?taskId=${taskId}`, { method: "POST", headers: { Cookie: this.cookie, Origin: origin, "X-CSRF-Token": csrf.csrfToken }, body }); }
}
const ctx = "ctx-jp-a-luna", target = { contextId: ctx, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: ["user-co"], productIds: ["product-serum"] };
const c = { ...blankContent(), title: "HTTP 실제 요청", description: "공개 원문 v1", internalOriginal: "INTERNAL_ONLY_G04", internalMemo: "관리 메모", deadline: { ...blankContent().deadline, responsibleUserId: "user-gsg", value: "2026-10-01" }, requirements: requirementTypes.map(type => ({ ...blankRequirement(`q-${type}`, type), label: `요건 ${type}`, options: type === "choice" ? ["yes", "no"] : [] })) };
c.milestones.push({ id: "print", kind: "printing_delivery", counterpart: "합성 제작사 확인", visibility: "public", deadline: { ...c.deadline, value: "2026-10-20", certainty: "needs_confirmation", raw: "10/20 수요일 (원문 충돌 유지)", source: "합성 외부 안내", sourceVersion: "rev1" } });
const admin = new Client(), brand = new Client(), team = new Client(), foreign = new Client();
async function detail(client: Client, id: string) { return client.json<TaskDetail>(`/api/tasks/${id}`); }
async function command(client: Client, id: string, command: string, extra: Record<string, unknown> = {}) { const d = await detail(client, id); const r = await client.mutate(`/api/tasks/${id}`, { command, expectedRevision: d.task.revision, idempotencyKey: randomUUID(), ...extra }); check(`${command} HTTP mutation`, r.status === 200, ["AC-04-01", "AC-04-04", "AC-04-05"]); return r; }
try {
    await start(); await admin.login("admin@example.test"); await brand.login("luna@example.test"); await team.login("team@example.test"); await foreign.login("wave@example.test");
    check("anonymous task list blocked", (await new Client().send(`/api/tasks?context=${ctx}`)).status === 401, ["A19"]);
    check("task create CSRF blocked", (await admin.send("/api/tasks", "POST", {})).status === 403, ["A19"]);
    check("brand cannot create task", (await brand.mutate("/api/tasks", { targets: [target], content: c, category: "spot", idempotencyKey: randomUUID() })).status === 403, ["A19"]);
    const createBody = { targets: [target], content: c, category: "spot", idempotencyKey: randomUUID() };
    const created = await admin.mutate("/api/tasks", createBody); check("actual task created", created.status === 201, ["AC-04-01"]); const taskId = (await created.json()).ids[0];
    const retry = await admin.mutate("/api/tasks", createBody); check("same command replay returns same task", (await retry.json()).ids[0] === taskId, ["AC-04-01", "A20"]);
    check("brand cannot read private draft", (await brand.send(`/api/tasks/${taskId}`)).status === 404, ["A19", "SA-12"]);
    check("foreign task hidden", (await foreign.send(`/api/tasks/${taskId}`)).status === 404, ["A19"]);
    const bytes = Buffer.from("%PDF-1.4\nSynthetic original G04 HTTP reference\n%%EOF");
    const uploaded = await admin.upload(taskId, bytes); check("multipart reference uploaded", uploaded.status === 201, ["A04", "SA-04", "partial-SA-19"]); const file = (await uploaded.json()).files[0];
    const raw = await admin.send(`/api/files/${file.id}?taskId=${taskId}`); check("manager exact original hash", createHash("sha256").update(Buffer.from(await raw.arrayBuffer())).digest("hex") === file.sha256, ["A04", "SA-04"]);
    check("draft file private", (await brand.send(`/api/files/${file.id}?taskId=${taskId}`)).status === 404, ["A19"]);
    check("forged extension rejected", (await admin.upload(taskId, bytes, "unsafe.exe")).status === 422, ["A04", "SA-04"]);
    c.referenceFileIds = [file.id]; await command(admin, taskId, "save", { content: c });
    const preview = await admin.json<{ content: unknown }>(`/api/tasks/${taskId}?preview=1`); await command(admin, taskId, "publish");
    const published = await detail(brand, taskId); check("preview equals actual public DTO", JSON.stringify(preview.content) === JSON.stringify(published.request), ["AC-04-02", "SA-12"]);
    check("all eight requirements roundtrip", published.request!.requirements.length === 8, ["SA-10"]);
    check("external deadline separate with original preserved", published.request!.deadline.value === "2026-10-01" && published.request!.milestones[0].deadline.value === "2026-10-20" && published.request!.milestones[0].deadline.raw.includes("원문 충돌"), ["AC-04-02", "A17"]);
    check("internal original absent from brand response", !JSON.stringify(published).includes("INTERNAL_ONLY_G04"), ["A19"]);
    const download = await brand.send(`/api/files/${file.id}?taskId=${taskId}&mode=preview`); check("authorized preview private no-store plus original bytes", download.status === 200 && download.headers.get("cache-control")!.includes("no-store") && createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex") === file.sha256, ["A04", "SA-04"]);
    check("file forged reference rejected", (await brand.send(`/api/files/${file.id}?taskId=task-wave`)).status === 404, ["A19"]);
    await command(team, taskId, "read"); const t = await detail(team, taskId); check("team read stays separate from acceptance", t.activities.some(a => a.data.kind === "read") && t.task.data.status === "requested", ["AC-04-05"]);
    check("team cannot accept", (await team.mutate(`/api/tasks/${taskId}`, { command: "accept", expectedRevision: t.task.revision, idempotencyKey: randomUUID() })).status === 403, ["A19"]);
    await command(admin, taskId, "hold", { reason: "V02 requested hold" }); await command(admin, taskId, "resume", { reason: "V02 requested restore" });
    check("V02 requested task resumes requested", (await detail(brand,taskId)).task.data.status === "requested", ["G04-V02","AC-04-05","SA-15"]);
    await command(brand, taskId, "accept"); const acceptanceBeforePause=(await detail(brand,taskId)).activities;
    await command(admin, taskId, "hold", { reason: "V02 accepted hold" }); await command(admin, taskId, "cancel", { reason: "V02 nested cancel" }); await command(admin, taskId, "hold", { reason: "V02 nested hold" }); await command(admin, taskId, "resume", { reason: "V02 restore accepted" });
    await command(brand, taskId, "accept"); const resumed=await detail(brand,taskId);
    check("V02 accepted nested pause resumes in_progress with identical acceptance history", resumed.task.data.status === "in_progress" && JSON.stringify(resumed.activities) === JSON.stringify(acceptanceBeforePause), ["G04-V02","AC-04-05","SA-15"]);
    check("V02 direct active resume rejects", (await admin.mutate(`/api/tasks/${taskId}`,{command:"resume",reason:"already active",expectedRevision:resumed.task.revision,idempotencyKey:randomUUID()})).status===409, ["G04-V02","SA-15"]);
    await command(brand, taskId, "schedule", { deadline: { ...c.deadline, value: "2026-11-03" }, reason: "브랜드 협의" });
    const requested = await detail(brand, taskId); check("schedule proposal does not alter deadline", requested.request!.deadline.value === c.deadline.value, ["AC-04-05"]);
    const v1 = published.versions[0].id, activityId = requested.activities.find(a => a.data.kind === "schedule")!.id;
    const draft = { ...c, description: "PRIVATE_DRAFT_NOT_PUBLISHED" }; await command(admin, taskId, "save", { content: draft }); await command(admin, taskId, "schedule_decide", { activityId, decision: "apply", reason: "기한만 반영" });
    const adjusted = await detail(brand, taskId), adjustedAdmin = await detail(admin, taskId);
    check("CR01 date only application leaves unpublished draft private", adjusted.request!.description === c.description && adjusted.request!.deadline.value === "2026-11-03" && adjustedAdmin.draft!.description === draft.description && !JSON.stringify(adjusted).includes("PRIVATE_DRAFT"), ["AC-04-05", "CR01"]);
    check("CR02 decision and resulting version persisted", adjusted.activities.some(a => a.data.decision === "apply" && a.data.requestId === v1 && a.data.resultingRequestId === adjusted.versions[0].id), ["AC-04-05", "CR02"]);
    const ordered = adjusted.activities.map(a => a.data.sequence); check("activities strictly ordered even when timestamps tie", ordered.every((n,i) => i === 0 || n > ordered[i-1]), ["AC-04-05"]);
    if (mode === "sqlite") {
        const fixtureRepo = createSqliteRepository(openDatabase(filename)); await fixtureRepo.transaction(s => s.create("priorSubmission", { id: "g04-prior-http-fixture", contextId: ctx, data: { taskId, requestId: v1, authorId: "user-luna", answers: [{ requirementKey: "q-short_text", productId: null, value: "합성 이전 답변", fileVersionIds: [] }] } })); fixtureRepo.close();
        const next = { ...c, requirements: [...c.requirements, { ...blankRequirement("added-file", "file"), label: "개정 추가 필수 파일" }] }; await command(admin, taskId, "save", { content: next }); await command(admin, taskId, "publish");
        const revised = await detail(brand, taskId); check("actual API prior-submission fixture retained and additions missing", revised.requirementStatus.some(q => q.requirementKey === "q-short_text" && q.status === "prior_received") && revised.requirementStatus.some(q => q.requirementKey === "added-file" && q.status === "missing"), ["AC-04-04", "D06"]);
        await command(admin,taskId,"hold",{reason:"V02 persist paused progress"}); const paused=await detail(brand,taskId);
        const beforeHash = createHash("sha256").update(JSON.stringify(paused)).digest("hex"); await stop(); await start(); check("actual different server process", processes[0].pid !== processes[1].pid, ["A20"]);
        const relogged = new Client(); await relogged.login("luna@example.test"); const after = await detail(relogged, taskId); check("all task versions activities and projection survive actual restart/relogin", createHash("sha256").update(JSON.stringify(after)).digest("hex") === beforeHash, ["A20", "AC-04-02", "AC-04-04", "AC-04-05"]);
        await command(admin,taskId,"resume",{reason:"V02 restart restore"}); const afterResume=await detail(relogged,taskId);
        check("V02 restart restores accepted progress while latest request remains unaccepted", afterResume.task.data.status==="in_progress" && !afterResume.activities.some(a=>a.data.kind==="accept"&&a.data.requestId===afterResume.versions[0].id), ["G04-V02","AC-04-05","A20"]);
        const restored = await relogged.send(`/api/files/${file.id}?taskId=${taskId}&mode=original`); check("immutable bytes survive restart", createHash("sha256").update(Buffer.from(await restored.arrayBuffer())).digest("hex") === file.sha256, ["A04", "SA-04"]);
        const inspect = createSqliteRepository(openDatabase(filename)); const events = await inspect.list("domainEvent", ctx); check("CR03 durable acceptance event exists once", events.filter(e => e.data.targetId === taskId && e.data.eventType === "TASK_ACCEPTED").length === 1, ["AC-04-05", "CR03"]); check("change notice event persisted", events.some(e => e.data.targetId === taskId && e.data.eventType === "TASK_REQUEST_REVISED"), ["AC-04-04", "D07"]); inspect.close();
    }
    if (mode === "sqlite") {
        async function legacy(status: "on_hold" | "cancelled" | "requested") {
            const fixture=createSqliteRepository(openDatabase(filename)); await fixture.transaction(s=>{const row=s.get("task",taskId)!;const data={...row.data,status};delete data.resumeStatus;s.update("task",taskId,row.revision,data);});fixture.close();
        }
        await legacy("cancelled"); await command(admin,taskId,"resume",{reason:"V02 legacy latest not accepted"});
        check("V02 legacy ignores acceptance for older request", (await detail(brand,taskId)).task.data.status==="requested", ["G04-V02","SA-15"]);
        await command(brand,taskId,"accept"); const accepted=(await detail(brand,taskId)).activities;
        await legacy("on_hold"); await command(admin,taskId,"resume",{reason:"V02 legacy latest accepted"});
        check("V02 legacy current acceptance restores progress", (await detail(brand,taskId)).task.data.status==="in_progress", ["G04-V02","SA-15"]);
        await legacy("requested"); await command(brand,taskId,"accept"); const repaired=await detail(brand,taskId);
        check("V02 old inconsistent requested repaired without new acceptance", repaired.task.data.status==="in_progress" && JSON.stringify(repaired.activities)===JSON.stringify(accepted), ["G04-V02","AC-04-05"]);
        const inspect=createSqliteRepository(openDatabase(filename)); const events=await inspect.list("domainEvent",ctx);
        check("V02 no duplicate acceptance event per request after repair", events.filter(e=>e.data.targetId===taskId&&e.data.eventType==="TASK_ACCEPTED").length===2, ["G04-V02","A20"]);inspect.close();
    }
    const catalog = await admin.json<TaskCatalog>(`/api/tasks?context=${ctx}`); check("seven basic templates present", catalog.templates.filter(t => t.builtin).length === 7, ["SA-47"]);
    const builtInApply = await admin.mutate("/api/templates", { command: "apply", contextId: ctx, versionId: "builtin-pop-v1", targets: [{ id: taskId, expectedRevision: (await detail(admin,taskId)).task.revision }], idempotencyKey: randomUUID() }); check("builtin template applies with explicit owner fallback", builtInApply.status === 200, ["SA-14"]);
    const oldFile = await brand.send(`/api/files/${file.id}?taskId=${taskId}`); check("old-version reference remains available and metadata projected", oldFile.status === 200 && (await detail(brand, taskId)).files.some(f => f.id === file.id), ["A04", "SA-04", "AC-04-04"]);
    if(projectionEnabled) {
        await command(admin,projectionTask,"publish"); const before=await storedProjectionSnapshot();
        const b=await detail(brand,projectionTask),g=await detail(admin,projectionTask),preview=await admin.json<{content:unknown}>(`/api/tasks/${projectionTask}?preview=1`),cat=await admin.json<TaskCatalog>(`/api/tasks?context=${ctx}`),project=await brand.json<unknown>("/api/projects/v03-http-project");
        const gsg=new Client();await gsg.login("gsg@example.test");const nonprice=await detail(gsg,projectionTask),nonpriceCatalog=await gsg.json<TaskCatalog>(`/api/tasks?context=${ctx}`);
        const objects={b,g,preview,cat,project,nonprice,nonpriceCatalog};writeFileSync(`${reportFile}.projection-api-private.json`,JSON.stringify(objects,null,2),{mode:0o600});
        check("V03 actual API current/history/draft/template/activity/project exclude stored nested extensions",!JSON.stringify(objects).includes(projectionMarker),["G04-V03","AC-04-02","A19"]);
        const expected=projectionContent(),{internalOriginal,internalMemo,...publicExpected}=expected;
        check("V03 all legitimate nested public fields preserved",isDeepStrictEqual(b.request,publicExpected)&&isDeepStrictEqual(b.versions[1].content,publicExpected)&&isDeepStrictEqual(preview.content,publicExpected),["G04-V03","AC-04-02"]);
        check("V03 allowed GSG original draft template retained and unknown price absent",g.draft?.internalOriginal===internalOriginal&&g.draft?.internalMemo===internalMemo&&isDeepStrictEqual(cat.templates.find(t=>t.id==="v03-http-template")!.content,expected)&&!JSON.stringify(b).includes(internalOriginal),["G04-V03","A19"]);
        check("V03 nonprice GSG retains permitted original but no unknown price extension",nonprice.draft?.internalOriginal===internalOriginal&&!JSON.stringify({nonprice,nonpriceCatalog}).includes(projectionMarker),["G04-V03","A19"]);
        check("V03 changedKeys strings and activity deadline preserved",JSON.stringify(b.versions[1].changedKeys)===JSON.stringify(["v03-text"])&&isDeepStrictEqual(b.activities[0].data.proposedDeadline,expected.deadline),["G04-V03","AC-04-02"]);
        for(const [label,client,url] of [["brand",brand,`/tasks/${projectionTask}?context=${ctx}`],["gsg",admin,`/tasks/${projectionTask}?context=${ctx}`],["templates",admin,`/tasks/templates?context=${ctx}`],["project",brand,"/projects/v03-http-project?context="+ctx]] as const){const response=await client.send(url);const html=await response.text();writeFileSync(`${reportFile}.projection-${label}-private.html`,html,{mode:0o600});check(`V03 actual SSR ${label} excludes extension markers`,response.status===200&&!html.includes(projectionMarker),["G04-V03","AC-02-02","A19"]);}
        const after=await storedProjectionSnapshot();writeFileSync(`${reportFile}.projection-stored-hashes.json`,JSON.stringify({before,after},null,2));check("V03 projection does not mutate stored history or extension originals",before.extensionStillStored&&after.extensionStillStored&&before.sha256===after.sha256,["G04-V03","A20"]);
        check("V03 unknown client content still rejected",(await admin.mutate(`/api/tasks/${projectionTask}`,{command:"save",content:{...expected,privateExtension:projectionMarker},expectedRevision:g.task.revision,idempotencyKey:randomUUID()})).status===422,["G04-V03","A19"]);
    }
} catch (error) { failure = error instanceof Error ? error.message : "unknown failure"; process.exitCode = 1; }
finally { await stop(); const report = { status: failure ? "FAIL" : "PASS", mode, level: "implementer-self-check", unit: "assertion", passed: checks.filter(c=>c.status==="PASS").length, failed: checks.filter(c=>c.status==="FAIL").length, skipped: 0, failure, checks, processes, actualHttp: true, projectionFixture: projectionEnabled ? (mode === "sqlite" ? "normal Next start with private persisted extension fixture" : "test-only Next startServer bootstrap with preloaded existing global mock repository cache; no product endpoint") : "disabled; regular boot", processRestart: mode === "sqlite", sqliteFixture: mode === "sqlite" ? "synthetic prior submission, actual G05 producer remains NOT_RUN" : null, credentialsAndCookies: "memory only; not recorded" }; writeFileSync(reportFile, JSON.stringify(report,null,2), { mode: 0o600 }); console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed, reportFile })); }
