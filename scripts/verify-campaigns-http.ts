import { blankCommon,blankContext } from '@/domain/products/types';
import type { MaterialTable } from '@/server/evidence/table';
import type { ProductList } from '@/server/products/service';
import { chromium,expect } from '@playwright/test';
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
import { campaignFixture, type CampaignFixtureInput, type CampaignFixtureSnapshot } from "./verify-campaigns-fixtures";
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
            input: CampaignFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await campaignFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.CAMPAIGNS_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("CAMPAIGNS_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4219), auxPort = validPort(process.env.E2E_AUX_PORT, 4220);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.CAMPAIGNS_HTTP_ROOT ?? ".local/g12-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "campaigns.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.CAMPAIGNS_HTTP_REPORT ?? path.join(directory, "report.json"));
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
    level: "HTTP" | "DB_FIXTURE" | "PROCESS" | "UI";
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
function check(id: string, condition: unknown, requirements = ["AC-12-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" | "UI" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-campaigns-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g12_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
async function fixture<T>(input: CampaignFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await campaignFixture(repo, input) as T;
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
import type { CampaignDetail,CampaignList } from '@/server/campaigns/contracts';
import type { CampaignDraft,MenuDraft,SourceText,SubmittedReference } from '@/domain/campaigns/types';
import type { ProductDetail } from '@/server/products/service';
import type { SubmissionWorkspace,SubmissionSnapshot,UploadResult } from '@/server/submissions/contracts';
import { blankDraft } from '@/domain/submissions/types';
const A='ctx-jp-a-luna',admin=new Client(),brand=new Client(),team=new Client(),foreign=new Client();
const person={kind:'user' as const,userId:'user-luna'},external={kind:'external_source' as const,label:'합성 외부 담당',source:'합성 전달 기록'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=','base64');
const byteHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const source=():SourceText=>({source:'PRIVATE_SOURCE',sourceVersion:'v1',locator:'p2',language:'ja',originalText:'PRIVATE_ORIGINAL 10000円',translatedText:'PRIVATE_TRANSLATION',fileVersionIds:[]});
const detail=(c:Client,id:string,v?:string)=>c.get<CampaignDetail>(`/api/campaigns/${id}${v?`?versionId=${v}`:''}`);
const persist=(name:string,value:unknown)=>writeFileSync(`${reportFile}.${name}.json`,JSON.stringify(value,null,2),{mode:0o600});
async function mutate(c:Client,body:unknown){const r=await c.mutate('/api/campaigns',body);assert.equal(r.status,200,await r.clone().text());return (await r.json()).ids as string[];}
async function command(c:Client,id:string,command:string,extra:Record<string,unknown>={}){const d=await detail(c,id);return mutate(c,{command,contextId:A,taskId:d.taskId,campaignId:id,expectedRevision:d.revision,idempotencyKey:randomUUID(),...extra});}
async function taskCommand(id:string,command:string,extra:Record<string,unknown>={}){const t=await admin.get<TaskDetail>(`/api/tasks/${id}`);const r=await admin.mutate(`/api/tasks/${id}`,{command,expectedRevision:t.task.revision,idempotencyKey:randomUUID(),...extra});assert.equal(r.status,200,await r.clone().text());}
async function actualSubmission(taskId:string){let w=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const csrf=await brand.get<{csrfToken:string}>('/api/auth/csrf'),body=new FormData();body.append('clientItemIds',randomUUID());body.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),'합성실행.png');const upload=await fetch(`${brand.origin}/api/tasks/${taskId}/submission-files?requestId=${w.request.id}`,{method:'POST',headers:{Cookie:brand.cookie,Origin:brand.origin,'X-CSRF-Token':csrf.csrfToken},body});await capture(upload,'POST multipart',`/api/tasks/${taskId}/submission-files?requestId=${w.request.id}`);assert.equal(upload.status,200,await upload.clone().text());const item=(await upload.json() as {items:UploadResult[]}).items[0];assert.equal(item.state,'ready');if(item.state!=='ready')throw Error('submission upload failed');
 const p=await brand.get<ProductDetail>(`/api/products/product-serum?context=${A}`),save=await brand.mutate(`/api/tasks/${taskId}/submission-draft`,{command:'save',baseRequestId:w.request.id,expectedDraftRevision:w.draft?.revision??0,content:{...blankDraft(),answers:[{requestId:w.request.id,requirementKey:'proof',productId:null,type:'file',input:{fileVersionIds:[item.file.id]}}],artifacts:[{fileVersionId:item.file.id,role:'evidence',answer:{requirementKey:'proof',productId:null}}],productSelections:[{productId:p.productId,expectedCommonRevision:p.commonRevision,expectedContextRevision:p.contextRevision,bindingIds:[],retailPriceVersionId:null,asOfDate:'2026-09-21'}]},idempotencyKey:randomUUID()});assert.equal(save.status,200,await save.clone().text());w=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const r=await brand.mutate(`/api/tasks/${taskId}/submissions`,{baseRequestId:w.request.id,expectedDraftRevision:w.draft!.revision,expectedTaskRevision:w.taskRevision,mode:'partial',idempotencyKey:randomUUID()});assert.equal(r.status,201,await r.clone().text());const sid=(await r.json()).ids[0],snapshot=await brand.get<SubmissionSnapshot>(`/api/submissions/${sid}`),reference:SubmittedReference={taskId,requestId:snapshot.requestId,submissionId:sid,contentHash:snapshot.contentHash,answer:{requirementKey:'proof',productId:null},fileVersionIds:[item.file.id],productUseIds:snapshot.products.map(p=>p.id)};return {snapshot,reference,fileId:item.file.id};
}
async function banner(taskId:string,viewport:{width:number;height:number},label:string){const browser=await chromium.launch();const context=await browser.newContext({viewport});await context.addCookies([{name:brand.cookie.slice(0,brand.cookie.indexOf('=')),value:brand.token,url:brand.origin,httpOnly:true,sameSite:'Lax'}]);await context.tracing.start({screenshots:true,snapshots:true,sources:true});const page=await context.newPage();try{await page.goto(`${brand.origin}/tasks/${taskId}?context=${A}`);await expect(page.getByRole('note',{name:'메뉴 선택 반영 요청',exact:true}).first()).toBeVisible();await expect(page.getByText('자료 요청 없음 · 이 요청 버전의 자동 제출 대상 항목은 없습니다.',{exact:true}).first()).toBeVisible();await expect(page.getByText(/취소 협의 중 · 이전 이행 범위 조정 확인 필요/).first()).toBeVisible();await page.screenshot({path:`${reportFile}.${label}.png`,fullPage:true});}catch(error){await page.screenshot({path:`${reportFile}.${label}-failure.png`,fullPage:true}).catch(()=>{});writeFileSync(`${reportFile}.${label}-failure.html`,await page.content(),{mode:0o600});throw error;}finally{await context.tracing.stop({path:`${reportFile}.${label}.trace.zip`});await browser.close();}}
let reachedEnd=false;const skippedIds:string[]=[];
try{
 if(mode==='sqlite'){const db=openDatabase(database,true);migrate(db);const repo=createSqliteRepository(db);await seed(repo);repo.close();}await start();
 check('G12-H01 anonymous and duplicate-scope query denied',(await new Client().send(`/api/campaigns?context=${A}`)).status===401,['A19']);
 await admin.login('admin@example.test');await brand.login('luna@example.test');await team.login('team@example.test');await foreign.login('wave@example.test');
 check('G12-H02 CSRF and duplicate query fail without mutation',(await admin.send('/api/campaigns','POST',{})).status===403&&(await admin.send(`/api/campaigns?context=${A}&context=${A}`)).status===422,['A19']);
 const c={...blankContent(),title:'HTTP 실제 행사 업무',description:'세 메뉴의 자료 요청',deadline:{...blankContent().deadline,responsibleUserId:'user-gsg'},requirements:[{...blankRequirement('proof','file'),label:'사진 리포트'},{...blankRequirement('url','link'),label:'게시 URL'},{...blankRequirement('other','number'),label:'다른 메뉴 수량'}]};
 const created=await admin.mutate('/api/tasks',{category:'spot',content:c,targets:[{contextId:A,ownerId:'user-gsg',assigneeId:'user-luna',coAssigneeIds:['user-co'],productIds:['product-serum']}],idempotencyKey:randomUUID()});assert.equal(created.status,201,await created.clone().text());const taskId=(await created.json()).ids[0] as string;await taskCommand(taskId,'publish');
 const catalogInput={command:'save_catalog',contextId:A,catalogId:null,expectedRevision:0,idempotencyKey:randomUUID(),draft:{title:'원본 카탈로그',versionLabel:'2026v1',source:source()}},catalog=(await mutate(admin,catalogInput))[1];
 check('G12-H03 catalog source GSG only; brand cannot create',(await brand.send(`/api/campaigns/catalogs?context=${A}`)).status===403&&(await brand.mutate('/api/campaigns',catalogInput)).status===403,['SA-44','A19']);
 const p=await admin.get<ProductDetail>(`/api/products/product-serum?context=${A}`),product={productId:p.productId,productVersionId:p.commonVersionId,contextProductVersionId:p.contextVersionId,productUseId:null,sampleVariant:'판매용30mL'};
 const menu=(key:string):MenuDraft=>({identity:{catalogVersionId:catalog,menuKey:key,menuName:'외부 메뉴 '+key,menuNumber:'1'},sourceStatements:[{id:'price1',field:'price',rawValue:'10000円',source:source()},{id:'price2',field:'price',rawValue:'12000円',source:{...source(),sourceVersion:'email-v2'}},{id:'date1',field:'date',rawValue:'2026-10-01',source:source()},{id:'date2',field:'date',rawValue:'2026-10-08',source:{...source(),language:'ko'}},{id:'number-ja',field:'menu_number',rawValue:'3',source:source()},{id:'number-ko',field:'menu_number',rawValue:'4',source:{...source(),language:'ko',sourceVersion:'translation-v2'}}],conflicts:[{field:'price',statementIds:['price1','price2'],state:'needs_confirmation',resolution:''},{field:'date',statementIds:['date1','date2'],state:'needs_confirmation',resolution:''},{field:'menu_number',statementIds:['number-ja','number-ko'],state:'needs_confirmation',resolution:''}],conditions:{state:'confirmed',sourceStatementIds:['price1','price2'],publicExplanation:'현재 견적 미정',cost:{amount:null,currency:null,taxIncluded:'unknown'},discount:'할인 별도',points:'포인트 별도',cancellationTerms:'신청 후 협의',schedules:[{key:'application',kind:'application',deadline:c.deadline}]},templateVersionId:null,request:{...c,title:'메뉴 '+key,internalOriginal:'PRIVATE_REQUEST',internalMemo:'PRIVATE_MEMO',requirements:key==='one'?c.requirements.slice(0,2):c.requirements.slice(2)},products:[product,{...product,sampleVariant:'배포용1mL'}],physical:key==='one'?[{key:'shoot',destination:'촬영 A',purpose:'촬영',product,requestedQuantity:'1',unit:'개',plannedShip:c.deadline,plannedArrival:c.deadline},{key:'distribute',destination:'배포 B',purpose:'배포',product:{...product,sampleVariant:'배포용1mL'},requestedQuantity:'100',unit:'개',plannedShip:c.deadline,plannedArrival:c.deadline}]:[],followups:key==='one'?[{key:'photo',kind:'execution_photo',requirementKey:'proof',deadline:c.deadline},{key:'url',kind:'publication_url',requirementKey:'url',deadline:{...c.deadline,value:'2026-11-01'}}]:[]});
 const secondCreated=await admin.mutate('/api/products',{contextId:A,brandId:p.context.data.brandId,common:{...blankCommon(),name:'HTTP 미선택 메뉴 상품',code:'G12-PRE01-HTTP'},fields:blankContext(),idempotencyKey:randomUUID()});assert.equal(secondCreated.status,201,await secondCreated.clone().text());const p2Id=(await secondCreated.json()).ids[0] as string,taskForLink=await admin.get<TaskDetail>(`/api/tasks/${taskId}`);const secondLinked=await admin.mutate(`/api/products/${p2Id}`,{command:'link_task',contextId:A,taskId,expectedTaskRevision:taskForLink.task.revision,idempotencyKey:randomUUID()});assert.equal(secondLinked.status,200,await secondLinked.clone().text());const second=await admin.get<ProductDetail>(`/api/products/${p2Id}?context=${A}`),secondTarget={productId:p2Id,productVersionId:second.commonVersionId,contextProductVersionId:second.contextVersionId,productUseId:null,sampleVariant:'미선택 상품'};
 const draft:CampaignDraft={title:'HTTP 합성 행사',menus:['one','two','three'].map(menu)};draft.menus[1].products=[secondTarget];draft.menus[2].products=[secondTarget];const id=(await mutate(admin,{command:'save',contextId:A,taskId,campaignId:null,expectedRevision:0,idempotencyKey:randomUUID(),draft}))[0];
 check('G12-H04 draft absent from brand list detail and event producer',(await brand.get<CampaignList>(`/api/campaigns?context=${A}`)).total===0&&(await brand.send(`/api/campaigns/${id}`)).status===404&&(await fixture<CampaignFixtureSnapshot>({campaignId:id})).rows.find(r=>r.kind==='domainEvent')!.rows.length===0,['SA-44','A19']);
 const preview=await admin.get(`/api/campaigns/${id}/preview`);check('G12-H05 preview excludes originals and conflict values',!JSON.stringify(preview).includes('PRIVATE_')&&!JSON.stringify(preview).includes('12000円'),['AC-12-05','SA-44']);
 const pubInput={command:'publish',contextId:A,taskId,campaignId:id,expectedRevision:(await detail(admin,id)).revision,idempotencyKey:randomUUID()},publication=await mutate(admin,pubInput),versionId=publication[1];check('G12-H06 publication same intent returns original version',hash(await mutate(admin,pubInput))===hash(publication),['A20']);
 const publicV1=await detail(brand,id),staffV1=await detail(admin,id);check('G12-H07 confirmed unknown price and original conflicts distinct',publicV1.selected!.menus[0].conditions.cost.amount===null&&publicV1.selected!.menus[0].confirmationIssues.map(c=>c.field).sort().join(',')==='date,menu_number,price'&&staffV1.staff!.publishedOriginal!.menus[0].sourceStatements.filter(s=>s.field==='menu_number').map(s=>s.rawValue).join(',')==='3,4'&&staffV1.staff!.publishedOriginal!.menus[0].sourceStatements[1].rawValue==='12000円'&&!JSON.stringify(publicV1).includes('PRIVATE_'),['AC-12-05']);
 const selectInput={command:'participate',contextId:A,taskId,campaignId:id,campaignVersionId:versionId,expectedRevision:publicV1.revision,idempotencyKey:randomUUID(),response:'participate',selectedMenus:[draft.menus[0].identity],providedBy:person,note:'참여 회신'};
 check('G12-H08 team readonly and foreign inquiry denied',(await team.mutate('/api/campaigns',selectInput)).status===403&&(await foreign.send(`/api/campaigns/${id}`)).status===404,['A19']);await mutate(brand,selectInput);
 let d=await detail(brand,id);const chosenWorkspace=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`),chosenTask=await brand.get<TaskDetail>(`/api/tasks/${taskId}`);check('G12-H09 three offered one selected activates only two chosen requirements',chosenWorkspace.request.content.requirements.map(q=>q.key).join(',')==='proof,url'&&chosenWorkspace.draftEvaluation?.required===2&&chosenTask.requirementStatus.length===2&&chosenWorkspace.request.source?.actorId==='user-luna'&&d.progress.filter(p=>p.active).length===1&&d.progress.map(p=>p.missingRequired).join(',')==='2,0,0'&&d.progress.every(p=>p.state.application==='not_applied'&&p.state.selection==='pending'),['AC-12-01','AC-12-02']);
 const g07=await brand.get<MaterialTable>(`/api/evidence/table?context=${A}`),g07p2=g07.rows.find(r=>r.productId===p2Id)!,p2detail=await brand.get<ProductDetail>(`/api/products/${p2Id}?context=${A}`),productList=await brand.get<ProductList>(`/api/products?context=${A}`);check('G12-H33 PRE01 actual G07 table product list detail exclude unselected P2 global requirements',g07p2.cells.filter(c=>c.taskId===taskId).every(c=>!c.applicable&&c.status==='not_applicable')&&g07p2.counts.requested===0&&g07p2.counts.missing===0&&p2detail.materialCounts.requested===0&&p2detail.materialCounts.missing===0&&productList.items.find(p=>p.productId===p2Id)!.materialCounts.missing===0&&chosenWorkspace.products.map(p=>p.productId).join(',')==='product-serum',['G12-PRE01','AC-12-01']);
 const actual=await actualSubmission(taskId),savedSubmission=hash(actual.snapshot);d=await detail(brand,id);check('G12-H10 actual partial G05 exact file/productUse reduces selected missing only',d.progress[0].missingRequired===1&&d.progress[1].missingRequired===0&&actual.snapshot.products.length===1,['AC-12-01','SA-46']);
 const fact={axis:'application',value:'applied',requester:person,performedBy:external,occurredAt:null,source:source(),note:'신청 확인'};await command(admin,id,'external',{campaignVersionId:versionId,menu:draft.menus[0].identity,fact});await command(admin,id,'external',{campaignVersionId:versionId,menu:draft.menus[1].identity,fact:{...fact,axis:'selection',value:'not_selected'}});await command(brand,id,'participate',{campaignVersionId:versionId,response:'decline',selectedMenus:[draft.menus[0].identity],providedBy:person,note:'불참 협의'});d=await detail(brand,id);
 check('G12-H11 applied decline retains application and creates only relevant cancellation discussion',d.progress[0].state.application==='applied'&&d.progress[0].state.cancellation==='discussion'&&d.progress[1].state.application==='not_applied'&&d.progress[1].state.selection==='not_selected'&&d.progress[1].state.cancellation==='none',['AC-12-02']);
 const declinedWorkspace=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);check('G12-H12 decline missing reminder0 preserves exact previous submission',declinedWorkspace.request.source?.noMaterials===true&&declinedWorkspace.request.source.retainedRequirementKeys.join(',')==='proof,url'&&declinedWorkspace.requiresRebase&&declinedWorkspace.draftEvaluation?.missing===0&&declinedWorkspace.draftEvaluation.invalid===0&&declinedWorkspace.products.length===0&&d.progress.every(p=>!p.reminderEligible&&p.missingRequired===0)&&hash(await brand.get(`/api/submissions/${actual.snapshot.id}`))===savedSubmission,['AC-12-01']);
 const emptyTable=await brand.get<MaterialTable>(`/api/evidence/table?context=${A}`);check('G12-H34 approved zero request leaves G07 source counts and both products empty',emptyTable.columns.every(c=>c.taskId!==taskId)&&emptyTable.rows.filter(r=>['product-serum',p2Id].includes(r.productId)).every(r=>r.counts.missing===0),['G12-PRE01','AC-12-01']);
 await banner(taskId,{width:1440,height:960},'decline-desktop');check('G12-H28 actual desktop G05 generated-request and cancellation banner',true,['AC-12-01','AC-12-02'],'UI');await banner(taskId,{width:390,height:844},'decline-mobile');check('G12-H29 actual 390px G05 generated-request and cancellation banner',true,['AC-12-01','AC-12-02'],'UI');
 const zeroRebase=await brand.mutate(`/api/tasks/${taskId}/submission-draft`,{command:'rebase_apply',baseRequestId:declinedWorkspace.draft!.baseRequestId,targetRequestId:declinedWorkspace.request.id,expectedDraftRevision:declinedWorkspace.draft!.revision,carryAnswers:[],idempotencyKey:randomUUID()});assert.equal(zeroRebase.status,200,await zeroRebase.clone().text());const zero=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);check('G12-H30 explicit zero-request rebase removes only current answer and product selections',zero.draft!.content.answers.length===0&&zero.draft!.content.productSelections.length===0&&!zero.requiresRebase&&hash(await brand.get(`/api/submissions/${actual.snapshot.id}`))===savedSubmission,['AC-12-01','SA-46']);
 await command(brand,id,'participate',{campaignVersionId:versionId,response:'participate',selectedMenus:[draft.menus[0].identity],providedBy:person,note:'다시 선택'});let selectedAgain=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);check('G12-H31 reselect requires explicit request/product rebase',selectedAgain.requiresRebase&&selectedAgain.products.length===1&&selectedAgain.draft!.content.answers.length===0,['SA-46']);const rebaseBack=await brand.mutate(`/api/tasks/${taskId}/submission-draft`,{command:'rebase_apply',baseRequestId:selectedAgain.draft!.baseRequestId,targetRequestId:selectedAgain.request.id,expectedDraftRevision:selectedAgain.draft!.revision,carryAnswers:[],idempotencyKey:randomUUID()});assert.equal(rebaseBack.status,200,await rebaseBack.clone().text());selectedAgain=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const fullContent={...actual.snapshot.content,answers:[...actual.snapshot.content.answers.map(a=>({...a,requestId:selectedAgain.request.id})),{requestId:selectedAgain.request.id,requirementKey:'url',productId:null,type:'link',input:{url:'https://example.test/published',description:'게시 URL',contentFixed:false,fixedReference:null}}]};const saveFull=await brand.mutate(`/api/tasks/${taskId}/submission-draft`,{command:'save',baseRequestId:selectedAgain.request.id,expectedDraftRevision:selectedAgain.draft!.revision,content:fullContent,idempotencyKey:randomUUID()});assert.equal(saveFull.status,200,await saveFull.clone().text());selectedAgain=await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);const full=await brand.mutate(`/api/tasks/${taskId}/submissions`,{baseRequestId:selectedAgain.request.id,expectedDraftRevision:selectedAgain.draft!.revision,expectedTaskRevision:selectedAgain.taskRevision,mode:'full',idempotencyKey:randomUUID()});assert.equal(full.status,201,await full.clone().text());const fullSnapshot=await brand.get<SubmissionSnapshot>(`/api/submissions/${(await full.json()).ids[0]}`);check('G12-H32 full actual submission requires selected menu only and keeps old exact file/productUse',fullSnapshot.evaluation.required===2&&fullSnapshot.evaluation.missing===0&&hash(await brand.get(`/api/submissions/${actual.snapshot.id}`))===savedSubmission,['AC-12-01','SA-46']);
 const physical={campaignVersionId:versionId,menu:draft.menus[0].identity,physicalKey:'shoot'},provenance={performedBy:external,occurredAt:null,evidence:[actual.reference],note:'합성 증빙'};await command(brand,id,'physical',{...physical,fact:{...provenance,kind:'tracking',carrier:'합성택배',trackingNumber:'0000123',trackingUrl:'https://example.test/tracking'}});d=await detail(brand,id);check('G12-H13 uploaded proof and tracking never dispatch receipt',d.progress[0].physical.every(p=>p.receiptFacts===0&&p.dispatchFacts===0),['AC-12-04']);
 const dispatch=(await command(brand,id,'physical',{...physical,fact:{...provenance,kind:'dispatch',quantity:'1',unit:'개',carrier:'합성택배',trackingNumber:'0000123'}}))[1];await command(brand,id,'physical',{...physical,fact:{...provenance,kind:'receipt',quantity:'0',unit:'개',dispatchFactIds:[dispatch]}});d=await detail(brand,id);check('G12-H14 shooting receipt0 is explicit observation not inferred fulfillment; distribution100 unchanged',d.progress[0].physical[0].receiptFacts===1&&d.progress[0].physical[0].fulfillment==='not_inferred'&&d.progress[0].physical[1].receiptFacts===0&&d.progress[0].physical[1].definition.requestedQuantity==='100',['AC-12-03','AC-12-04']);
 const followup={campaignVersionId:versionId,menu:draft.menus[0].identity,followupKey:'photo',source:actual.reference,receivedBy:external,occurredAt:null,note:'외부 수령 기록'};await command(brand,id,'followup',followup);d=await detail(brand,id);const fileUrl=d.progress[0].followups[0].facts[0].source.files[0].originalUrl;
 check('G12-H15 followup photo received while separate URL deadline remains pending',d.progress[0].followups.map(f=>f.status).join(',')==='received,pending'&&d.progress[0].followups[1].definition.deadline.value==='2026-11-01',['SA-49']);check('G12-H16 exact current-auth original bytes through campaign reference',byteHash(Buffer.from(await (await brand.send(fileUrl)).arrayBuffer()))===byteHash(png),['D02']);
 const beforeBad=await fixture<CampaignFixtureSnapshot>({campaignId:id}),bad={command:'followup',contextId:A,taskId,campaignId:id,expectedRevision:d.revision,idempotencyKey:randomUUID(),...followup,source:{...actual.reference,contentHash:'f'.repeat(64)}};check('G12-H17 wrong exact target returns404 and writes no partial facts',(await brand.mutate('/api/campaigns',bad)).status===404&&(await fixture<CampaignFixtureSnapshot>({campaignId:id})).rowsSha256===beforeBad.rowsSha256,['A19','A20']);
 const publicBefore=await detail(brand,id);draft.title='PRIVATE_EDIT';await command(admin,id,'save',{draft});check('G12-H18 internal draft edits leave every brand body field and publicCAS unchanged',hash(await detail(brand,id))===hash(publicBefore),['A19']);
 const racer=new Client(mode==='sqlite'?auxPort:port);if(mode==='sqlite')await start(auxPort);await racer.login('admin@example.test');const rev=(await detail(admin,id)).revision;const race=await Promise.all([admin,racer].map((c,i)=>c.mutate('/api/campaigns',{command:'save',contextId:A,taskId,campaignId:id,expectedRevision:rev,idempotencyKey:randomUUID(),draft:{...draft,title:'경합 '+i}})));check('G12-H19 two-session or actual twoPID CAS exactly one winner',race.map(r=>r.status).sort().join(',')==='200,409',['A20']);
 await command(admin,id,'external',{campaignVersionId:versionId,menu:draft.menus[0].identity,fact:{...fact,axis:'cancellation',value:'cancelled',note:'GSG의 명시 외부 취소 확인'}});
 const concurrent={...pubInput,expectedRevision:(await detail(admin,id)).revision,idempotencyKey:randomUUID()},replies=await Promise.all([admin,racer].map(c=>c.mutate('/api/campaigns',concurrent))),ids=await Promise.all(replies.map(r=>r.json()));const observed=await fixture<CampaignFixtureSnapshot>({campaignId:id});check('G12-H20 same-intent publication one version event receipt',replies.every(r=>r.status===200)&&hash(ids[0])===hash(ids[1])&&observed.rows.find(r=>r.kind==='domainEvent')!.rows.filter(r=>'sourceVersionId'in r.data&&r.data.sourceVersionId===ids[0].ids[1]).length===1&&observed.rows.find(r=>r.kind==='commandReceipt')!.rows.filter(r=>'key' in r.data&&r.data.key===hash(`user-admin:${A}:campaign.publish:${id}:${concurrent.idempotencyKey}`)).length===1,['A20']);
 const extension=await fixture<CampaignFixtureSnapshot>({campaignId:id,action:'extension'});persist('extension',extension);check('G12-H21 stored valid nested extras retained but omitted from staff/brand DTOs',JSON.stringify(extension).includes('G12_STORED_CANARY')&&!JSON.stringify(await detail(brand,id)).includes('CANARY')&&!JSON.stringify(await detail(admin,id)).includes('CANARY'),['A19']);
 const beforeRestart=await detail(brand,id),staffBefore=await detail(admin,id),rowsBefore=await fixture<CampaignFixtureSnapshot>({campaignId:id});persist('before-restart',rowsBefore);
 if(mode==='sqlite'){await stop(auxPort);await stop(port);await start();const again=new Client(),againAdmin=new Client();await again.login('luna@example.test');await againAdmin.login('admin@example.test');check('G12-H22 actual newPID restart and real relogin',processes[0].pid!==processes.at(-1)!.pid,['D10'],'PROCESS');check('G12-H23 private/public versions/facts/productUse/receipt persisted byte-exact',hash(await detail(again,id))===hash(beforeRestart)&&hash(await detail(againAdmin,id))===hash(staffBefore)&&(await fixture<CampaignFixtureSnapshot>({campaignId:id})).rowsSha256===rowsBefore.rowsSha256,['D10']);check('G12-H24 historical source file bytes survive restart',byteHash(Buffer.from(await (await again.send(fileUrl)).arrayBuffer()))===byteHash(png),['D02','D10']);}else skippedIds.push('G12-H22','G12-H23','G12-H24');
 const members=await admin.get<{members:{id:string;revision:number;data:{userId:string;scope:string}}[]}>(`/api/contexts/${A}/members`),member=members.members.find(m=>m.data.userId==='user-luna')!;const revoked=await admin.mutate(`/api/contexts/${A}/members/${member.id}`,{expectedRevision:member.revision,status:'suspended',scope:member.data.scope,internalPriceAccess:false},'PATCH');check('G12-H25 current membership revoke blocks history/file/successful receipt replay',revoked.status===200&&(await brand.send(`/api/campaigns/${id}`)).status===404&&(await brand.send(fileUrl)).status===404&&(await brand.mutate('/api/campaigns',selectInput)).status===404,['A19','D02']);
 check('G12-H26 revoke does not erase immutable public or fact history',(await fixture<CampaignFixtureSnapshot>({campaignId:id})).rowsSha256===rowsBefore.rowsSha256,['D10'],'DB_FIXTURE');const corrupt=await fixture<CampaignFixtureSnapshot>({campaignId:id,action:'corrupt'});persist('corrupt',corrupt);const corrupted=await admin.send(`/api/campaigns/${id}`);check('G12-H27 stored malformed known nested amount fails503 without rawcanary',corrupted.status===503&&!(await corrupted.text()).includes('KNOWN_CORRUPTION'),['A19']);reachedEnd=true;
}catch(error){failure=error instanceof Error?error.message:'unknown failure';process.exitCode=1;}
finally{for(const p of [...children.keys()])await stop(p);const report={candidate_commit:candidate,session_uuid:'01a0c307-c975-75b1-b96a-5a5c4e448aec',runner_sha256:hash(readFileSync('scripts/verify-campaigns-http.ts','utf8')),fixture_runner_sha256:hash(readFileSync('scripts/verify-campaigns-fixtures.ts','utf8')),status:failure?'FAIL':'PASS',mode,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),failure,count_unit:'assertion',pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length+(failure&&!checks.some(c=>c.status==='FAIL')?1:0),skip:skippedIds.length,skipped_ids:skippedIds,not_run:reachedEnd?0:34-checks.length-skippedIds.length,reachedEnd,checks,transcript,processes,resources:{port,auxPort,database,files},fixture_boundary:'Actual task/submission/product/campaign/file HTTP producers; private mock IPC observer and explicit stored-corruption fixtures only. SQLite normal Next start. No product test endpoint/auth bypass. G12 UI and independent verification NOT_RUN.'};writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,reportFile}));}
