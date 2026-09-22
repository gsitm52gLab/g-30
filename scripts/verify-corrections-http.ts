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
import { correctionFixture, type CorrectionFixtureInput, type CorrectionFixtureSnapshot } from "./verify-corrections-fixtures";
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
            input: CorrectionFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await correctionFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.CORRECTIONS_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("CORRECTIONS_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4215), auxPort = validPort(process.env.E2E_AUX_PORT, 4216);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.CORRECTIONS_HTTP_ROOT ?? ".local/g10-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "corrections.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.CORRECTIONS_HTTP_REPORT ?? path.join(directory, "report.json"));
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
function check(id: string, condition: unknown, requirements = ["AC-10-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-corrections-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g10_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
async function fixture<T>(input: CorrectionFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await correctionFixture(repo, input) as T;
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
import type { CorrectionWorkspace,CorrectionBatch,CorrectionPreview,CorrectionCommandResult,ReviewTarget,OpinionInput,BatchDraftInput } from '@/server/corrections/contracts';
import type { SubmissionWorkspace,SubmissionSnapshot,UploadResult } from '@/server/submissions/contracts';
import type { ProductDetail } from '@/server/products/service';
import { blankDraft } from '@/domain/submissions/types';
const A='ctx-jp-a-luna',admin=new Client(),brand=new Client(),team=new Client(),foreign=new Client();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=','base64');
const byteHash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
let taskId='',reachedEnd=false;
const workspace=(c=admin)=>c.get<CorrectionWorkspace>(`/api/corrections?taskId=${taskId}`);
const batch=(id:string,c=brand)=>c.get<CorrectionBatch>(`/api/corrections/${id}`);
function persist(name:string,v:unknown){writeFileSync(`${reportFile}.${name}.json`,JSON.stringify(v,null,2),{mode:0o600});}
async function cmd(c:Client,body:Record<string,unknown>){const r=await c.mutate('/api/corrections',{taskId,idempotencyKey:randomUUID(),...body});assert.equal(r.status,200,await r.clone().text());return (await r.json() as CorrectionCommandResult).ids;}
async function actualSubmission(label:string):Promise<ReviewTarget>{
 let w=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const csrf=await brand.get<{csrfToken:string}>('/api/auth/csrf'),body=new FormData();body.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),label+'.png');body.append('clientItemIds',randomUUID());
 const url=`/api/tasks/${taskId}/submission-files?requestId=${w.request.id}`,uploaded=await fetch(brand.origin+url,{method:'POST',headers:{Cookie:brand.cookie,Origin:brand.origin,'X-CSRF-Token':csrf.csrfToken},body});await capture(uploaded,'POST multipart',url);assert.equal(uploaded.status,200);const item=(await uploaded.json() as {items:UploadResult[]}).items[0];assert.equal(item.state,'ready');if(item.state!=='ready')throw Error('actual upload failed');
 const p=await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`),content={...blankDraft(),answers:[{requestId:w.request.id,requirementKey:'answer',productId:null,type:'long_text',input:{text:label}}],artifacts:[{fileVersionId:item.file.id,role:'review_copy',answer:null}],productSelections:[{productId:p.productId,expectedCommonRevision:p.commonRevision,expectedContextRevision:p.contextRevision,bindingIds:[],retailPriceVersionId:null,asOfDate:'2026-09-21'}]};
 const saved=await brand.mutate(`/api/tasks/${taskId}/submission-draft`,{command:'save',baseRequestId:w.request.id,expectedDraftRevision:w.draft?.revision??0,content,idempotencyKey:randomUUID()});assert.equal(saved.status,200,await saved.clone().text());w=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const submitted=await brand.mutate(`/api/tasks/${taskId}/submissions`,{baseRequestId:w.request.id,expectedDraftRevision:w.draft!.revision,expectedTaskRevision:w.taskRevision,mode:'full',idempotencyKey:randomUUID()});assert.equal(submitted.status,201,await submitted.clone().text());const id=(await submitted.json()).ids[0] as string,snapshot=await brand.get<SubmissionSnapshot>(`/api/submissions/${id}`);return {taskId,submissionId:id,requestId:snapshot.requestId,submissionContentHash:snapshot.contentHash,answer:null,fileVersionIds:[item.file.id],productUseIds:snapshot.products.map(p=>p.id),location:{page:'2',locator:'lower emblem'}};
}
const opinion=(target:ReviewTarget,internalFileVersionIds:string[]=[]):OpinionInput=>({target,source:{kind:'external_opinion',agency:'Synthetic agency',reviewer:'Reviewer',source:'PRIVATE_G10_MAIL'},originalText:'PRIVATE_G10_ORIGINAL',internalFileVersionIds,receivedOn:'2026-09-21',conflictingOpinionVersionIds:[]});
async function draft(target:ReviewTarget,previousBatchVersionId:string|null=null):Promise<BatchDraftInput>{const items=[];for(const key of ['one','two','three']){const ids=await cmd(admin,{command:'save_opinion',opinionId:null,expectedRevision:0,opinion:opinion(target)});items.push({key,target,internalOpinionVersionIds:[ids[1]],publicSource:'Public source',change:'Change '+key,reason:'Reason',publicDescription:'Selected public explanation',priority:'normal' as const,issue:'correction' as const});}return {title:'Public change batch',summary:'Three selected items',items,mode:'normal',pendingScopes:[],previousBatchVersionId};}
const save=(d:BatchDraftInput)=>cmd(admin,{command:'save_draft',draftId:null,expectedRevision:0,draft:d});
try{
 if(mode==='sqlite'){const db=openDatabase(database,true);migrate(db);const repo=createSqliteRepository(db);await seed(repo);repo.close();}
 await start();check('G10-H01 anonymous request denied',(await new Client().send('/api/corrections?taskId=task-onboarding')).status===401,['A19']);
 await admin.login('admin@example.test');await brand.login('luna@example.test');await team.login('team@example.test');await foreign.login('wave@example.test');
 check('G10-H02 unsafe origin CSRF and unknown operation rejected',(await admin.send('/api/corrections','POST',{})).status===403&&(await admin.mutate('/api/corrections',{command:'approve_everything'})).status===422,['A19']);
 const content={...blankContent(),title:'G10 actual correction source',description:'Actual public submission',deadline:{...blankContent().deadline,responsibleUserId:'user-gsg'},requirements:[{...blankRequirement('answer'),label:'Answer'}]},created=await admin.mutate('/api/tasks',{targets:[{contextId:A,ownerId:'user-gsg',assigneeId:'user-luna',coAssigneeIds:[],productIds:['product-serum']}],content,category:'spot',idempotencyKey:randomUUID()});assert.equal(created.status,201,await created.clone().text());taskId=(await created.json()).ids[0];const t=await admin.get<TaskDetail>(`/api/tasks/${taskId}`),published=await admin.mutate(`/api/tasks/${taskId}`,{command:'publish',expectedRevision:t.task.revision,idempotencyKey:randomUUID()});assert.equal(published.status,200,await published.clone().text());
 const v1=await actualSubmission('v1'),internalResponse=await admin.upload(`taskId=${taskId}`,png,'PRIVATE_G10_FILE.png','image/png','internal');assert.equal(internalResponse.status,201);const internal=(await internalResponse.json()).files[0] as {id:string};
 const opinions=await cmd(admin,{command:'save_opinion',opinionId:null,expectedRevision:0,opinion:opinion(v1,[internal.id])}),d=await draft(v1);d.items[0].internalOpinionVersionIds=[opinions[1]];const draftId=(await save(d))[0],pre=await workspace(brand),facts=await fixture<CorrectionFixtureSnapshot>({taskId});persist('private-before-publication',facts);
 check('G10-H03 collecting private opinions exposes zero public batch and events',pre.batches.length===0&&pre.staff===null&&!facts.rows.find(r=>r.kind==='domainEvent')!.rows.some(r=>'eventType'in r.data&&r.data.eventType==='CORRECTION_BATCH_PUBLISHED'),['AC-10-01']);
 const preview=await admin.get<CorrectionPreview>(`/api/corrections/drafts/${draftId}/preview`);
 check('G10-H04 preview recursive public projection and brand access denial',preview.items.length===3&&!JSON.stringify(preview).includes('PRIVATE_G10')&&!JSON.stringify(preview).includes('internalOpinion')&&(await brand.send(`/api/corrections/drafts/${draftId}/preview`)).status===403,['AC-10-01','A19']);
 const pubInput={command:'publish',draftId,expectedRevision:1,idempotencyKey:randomUUID()},first=(await cmd(admin,pubInput))[0],replay=(await cmd(admin,pubInput))[0];
 check('G10-H05 same publication intent yields original immutable batch',first===replay&&(await workspace()).batches.length===1,['A20']);
 let current=await batch(first);check('G10-H06 selected public fields retained internal source IDs names absent',current.items.length===3&&current.items[0].publicSource==='Public source'&&!JSON.stringify(current).includes('PRIVATE_G10')&&!JSON.stringify(current).includes(opinions[1]),['AC-10-01','A19']);
 const publicFile=current.items[0].source.files[0],download=await brand.send(publicFile.originalUrl);
 check('G10-H07 current public exact target bytes and internal guessed IDs blocked',download.status===200&&byteHash(Buffer.from(await download.arrayBuffer()))===byteHash(png)&&(await brand.send(`/api/corrections/files/${internal.id}?batchVersionId=${first}&itemKey=one`)).status===404&&(await brand.send(`/api/files/${internal.id}?taskId=${taskId}&mode=original`)).status===404,['D02','A19']);
 check('G10-H08 same-context team reads publication but cannot write and foreign remains neutral', (await batch(first,team)).id===first&&(await team.mutate('/api/corrections',{taskId,...pubInput})).status===403&&(await foreign.send(`/api/corrections/${first}`)).status===404,['A19']);
 const stable=hash(current),root=(await workspace()).staff!.opinions.find(o=>o.id===opinions[0])!;await cmd(admin,{command:'save_opinion',opinionId:root.id,expectedRevision:root.revision,opinion:{...opinion(v1,[internal.id]),originalText:'PRIVATE_G10_LATE'}});
 check('G10-H09 editing opinion appends version without public body time order changes',hash(await batch(first))===stable&&(await workspace()).staff!.opinions.find(o=>o.id===root.id)!.versions.length===2,['AC-10-01','AC-10-03']);
 const v2=await actualSubmission('v2');check('G10-H10 upload and full new submission leave all correction items pending',(await batch(first)).items.every(i=>i.state.status==='pending'),['AC-10-02']);
 const reflectionInput={command:'reflect',batchVersionId:first,items:['one','two'].map(itemKey=>({itemKey,expectedItemRevision:0,target:v2,note:'Explicit reflected v2'})),idempotencyKey:randomUUID()},reflections=await cmd(brand,reflectionInput);
 check('G10-H11 only selected two reflected and same intent stable',JSON.stringify((await batch(first)).items.map(i=>i.state.status))==='["reflected","reflected","pending"]'&&hash(await cmd(brand,reflectionInput))===hash(reflections),['AC-10-02','A20']);
 const resolution={command:'resolve',batchVersionId:first,items:[{itemKey:'one',expectedItemRevision:1,reflectionId:reflections[0],decision:'resolved',reason:''},{itemKey:'two',expectedItemRevision:1,reflectionId:reflections[1],decision:'not_reflected',reason:'Wrong emblem file'}]};await cmd(admin,resolution);current=await batch(first);
 check('G10-H12 separate GSG per-item resolution wrong-file and pending remain',JSON.stringify(current.items.map(i=>i.state.status))==='["resolved","not_reflected","pending"]'&&(await workspace(brand)).remainder.unresolved===2,['AC-10-02']);
 check('G10-H13 brand cannot resolve and invalid old file target does not mutate',(await brand.mutate('/api/corrections',{taskId,idempotencyKey:randomUUID(),...resolution})).status===403&&(await brand.mutate('/api/corrections',{taskId,idempotencyKey:randomUUID(),command:'reflect',batchVersionId:first,items:[{itemKey:'three',expectedItemRevision:0,target:{...v2,fileVersionIds:v1.fileVersionIds},note:''}]})).status===404&&(await batch(first)).items[2].state.revision===0,['AC-10-02','A19']);
 const oldSnap=await brand.get<SubmissionSnapshot>(`/api/submissions/${v1.submissionId}`),reviewBase={command:'record_review',target:v1,source:opinion(v1).source,scope:{medium:'label',language:'ja',usePlace:'Retail A',productIds:['product-serum']},receivedOn:'2026-09-21',result:'no_changes_requested',rationale:'PRIVATE_G10_REVIEW',evidenceFileVersionIds:v1.fileVersionIds,previousReviewId:null},reviewId=(await cmd(admin,reviewBase))[0];
 check('G10-H14 actual internal review leaves brand summary unchanged',hash((await brand.get<SubmissionSnapshot>(`/api/submissions/${v1.submissionId}`)).review)===hash(oldSnap.review),['AC-10-04','A19']);
 const nextSnapshot=await admin.get<SubmissionSnapshot>(`/api/submissions/${v2.submissionId}`);check('G10-H15 new submitted version has actual connected zero reviews no inherited approval',nextSnapshot.review.connected&&nextSnapshot.review.status==='pending'&&nextSnapshot.review.reviews.length===0,['AC-10-04']);
 await cmd(admin,{...reviewBase,target:v2,evidenceFileVersionIds:v2.fileVersionIds,previousReviewId:reviewId,result:'needs_confirmation',scope:{...reviewBase.scope,language:'en'}});
 check('G10-H16 explicit previous reference preserves independently chosen new scope result',(await workspace()).staff!.reviews.some(r=>r.target.submissionId===v2.submissionId&&r.previousReviewId===reviewId&&r.result==='needs_confirmation'&&r.scope.language==='en'&&r.previousReviewIsReferenceOnly),['AC-10-04']);
 check('G10-H17 AI candidate cannot be faked',(await admin.mutate('/api/corrections',{taskId,idempotencyKey:randomUUID(),...reviewBase,source:{kind:'ai_candidate',runId:'missing',findingId:'missing',source:'AI'}})).status===409,['AC-10-04']);
 const follow=await draft(v1,first);follow.mode='urgent_partial';follow.pendingScopes=[{agency:'Pending agency',scope:'Emblem',expectedOn:null}];follow.items[0].issue='conflicting_opinions';follow.items[0].internalOpinionVersionIds.push(follow.items[1].internalOpinionVersionIds[0]);follow.items[0].publicDescription='Conflicting opinions need confirmation';const followDraft=(await save(follow))[0],followId=(await cmd(admin,{command:'publish',draftId:followDraft,expectedRevision:1}))[0];
 check('G10-H18 immutable followup conflicting item and urgent pending scope remain explicit',(await batch(followId)).previousBatchVersionId===first&&(await batch(followId)).items[0].state.status==='needs_confirmation'&&(await batch(followId)).pendingScopes[0].expectedOn===null&&(await batch(first)).items[1].history.resolutions[0].reason==='Wrong emblem file',['AC-10-03']);
 const badTargets=[{...v1,submissionContentHash:'f'.repeat(64)},{...v1,requestId:'missing-request'},{...v1,productUseIds:v2.productUseIds},{...v1,answer:{requirementKey:'missing',productId:null}}];const beforeInvalid=await fixture<CorrectionFixtureSnapshot>({taskId});for(const target of badTargets)assert.equal((await admin.mutate('/api/corrections',{taskId,command:'save_opinion',opinionId:null,expectedRevision:0,opinion:opinion(target),idempotencyKey:randomUUID()})).status,404);
 check('G10-H19 exact target relation failures write no facts audit outbox or receipts',(await fixture<CorrectionFixtureSnapshot>({taskId})).rowsSha256===beforeInvalid.rowsSha256,['A19','A20']);
 const html=await (await brand.send(`/tasks/${taskId}?context=${A}`)).text();check('G10-H20 existing G05 task HTML carries no internal source even with review summary connected',html.includes('G10 actual correction source')&&!html.includes('PRIVATE_G10'),['A19']);
 const raceDraft=(await save(await draft(v1,followId)))[0],racer=new Client(mode==='sqlite'?auxPort:port);if(mode==='sqlite')await start(auxPort);await racer.login('admin@example.test');const raceBody=(await workspace()).staff!.drafts.find(d=>d.id===raceDraft)!.draft;
 const changed=await Promise.all([admin,racer].map((c,i)=>c.mutate('/api/corrections',{taskId,command:'save_draft',draftId:raceDraft,expectedRevision:1,draft:{...raceBody,title:'Race '+i},idempotencyKey:randomUUID()})));
 check('G10-H21 concurrent draft CAS exactly one winner',changed.map(r=>r.status).sort().join(',')==='200,409',['A20'],mode==='sqlite'?'PROCESS':'HTTP');
 const shared={taskId,command:'publish',draftId:raceDraft,expectedRevision:2,idempotencyKey:randomUUID()},pubs=await Promise.all([admin,racer].map(c=>c.mutate('/api/corrections',shared))),values=await Promise.all(pubs.map(r=>r.json()));
 const raceFacts=await fixture<CorrectionFixtureSnapshot>({taskId}),raceId=values[0].ids[0];persist('race-facts',raceFacts);
 check('G10-H22 same-intent cross-session publication one immutable batch event receipt',pubs.every(r=>r.status===200)&&hash(values[0])===hash(values[1])&&(await workspace()).batches.filter(b=>b.id===raceId).length===1&&raceFacts.rows.find(r=>r.kind==='domainEvent')!.rows.filter(r=>'sourceVersionId'in r.data&&r.data.sourceVersionId===raceId&&'eventType'in r.data&&r.data.eventType==='CORRECTION_BATCH_PUBLISHED').length===1&&raceFacts.rows.find(r=>r.kind==='commandReceipt')!.rows.filter(r=>'result'in r.data&&typeof r.data.result==='object'&&r.data.result!==null&&'ids'in r.data.result&&Array.isArray(r.data.result.ids)&&r.data.result.ids.includes(raceId)).length===1,['A20'],mode==='sqlite'?'PROCESS':'HTTP');
 const extension=await fixture<CorrectionFixtureSnapshot>({taskId,action:'extension',batchId:first});persist('stored-extension',extension);check('G10-H23 stored unknown nested extension remains original but absent from legitimate public DTO',JSON.stringify(extension).includes('G10_STORED_PRIVATE')&&!JSON.stringify(await batch(extension.fixtureBatchId!)).includes('G10_STORED_PRIVATE')&&(await batch(extension.fixtureBatchId!)).items[0].publicSource==='Public source',['A19']);
 const restart=await fixture<CorrectionFixtureSnapshot>({taskId}),beforeRestart=await workspace(brand),beforeStaff=await workspace(admin);persist('before-restart',restart);
 if(mode==='sqlite'){await stop(auxPort);await stop(port);await start();const again=new Client(),gsgAgain=new Client();await again.login('luna@example.test');await gsgAgain.login('admin@example.test');check('G10-H24 new PID and actual relogin preserve public and internal records',processes[0].pid!==processes.at(-1)!.pid&&hash(await workspace(again))===hash(beforeRestart)&&hash(await workspace(gsgAgain))===hash(beforeStaff),['D10','A20'],'PROCESS');check('G10-H25 restart preserves all original facts product uses and receipt bytes',(await fixture<CorrectionFixtureSnapshot>({taskId})).rowsSha256===restart.rowsSha256&&(await fixture<CorrectionFixtureSnapshot>({taskId})).businessSha256===restart.businessSha256,['D10'],'DB_FIXTURE');check('G10-H26 historical file hash persists after restart',byteHash(Buffer.from(await (await again.send(publicFile.originalUrl)).arrayBuffer()))===byteHash(png),['D10','D02']);}
 const members=await admin.get<{members:{id:string;revision:number;data:{userId:string}}[]}>(`/api/contexts/${A}/members`),member=members.members.find(m=>m.data.userId==='user-luna')!;assert.equal((await admin.mutate(`/api/contexts/${A}/members/${member.id}`,{expectedRevision:member.revision,status:'suspended'},'PATCH')).status,200);
 check('G10-H27 current revocation denies exact history files and same-intent reflection replay',(await brand.send(`/api/corrections/${first}`)).status===404&&(await brand.send(publicFile.originalUrl)).status===404&&(await brand.mutate('/api/corrections',{taskId,...reflectionInput})).status===404,['A19','D02']);
 check('G10-H28 permission removal does not delete immutable facts',(await fixture<CorrectionFixtureSnapshot>({taskId})).rowsSha256===restart.rowsSha256,['D10'],'DB_FIXTURE');
 const corrupt=await fixture<CorrectionFixtureSnapshot>({taskId,action:'corruption',batchId:first});persist('malformed-stored',corrupt);const corruptRead=await admin.send(`/api/corrections/${corrupt.fixtureBatchId}`);check('G10-H29 known malformed stored public value is safe503 with no canary',corruptRead.status===503&&!(await corruptRead.text()).includes('G10_KNOWN_CORRUPT'),['A19']);
 reachedEnd=true;
}catch(error){failure=error instanceof Error?error.message:'unknown failure';process.exitCode=1;}
finally{for(const p of [...children.keys()])await stop(p);const report={candidate_commit:candidate,session_uuid:'01a0c307-c975-75b1-b96a-5a5c4e448aec',runner_sha256:hash(readFileSync('scripts/verify-corrections-http.ts','utf8')),fixture_runner_sha256:hash(readFileSync('scripts/verify-corrections-fixtures.ts','utf8')),status:failure?'FAIL':'PASS',mode,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),failure,count_unit:'assertion',pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length+(failure&&!checks.some(c=>c.status==='FAIL')?1:0),skip:mode==='mock'?3:0,skipped_ids:mode==='mock'?['G10-H24','G10-H25','G10-H26']:[],reachedEnd,not_run:'G10 UI/independent/integrated acceptance and G13/G16 producer consumers NOT_RUN',checks,transcript,processes,resources:{port,auxPort,database,files},fixture_boundary:'Normal SQLite Next start; mock private child repository injection/IPC for stored extension/corruption snapshot only. Actual HTTP task/G05/G10/file producers; no product test endpoint.'};writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,reportFile}));}
