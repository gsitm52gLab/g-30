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
import { blankContent } from "@/domain/tasks/types";
import type { TaskDetail } from "@/server/tasks/service";
import { inquiryFixture, type InquiryFixtureInput, type InquiryFixtureSnapshot } from "./verify-inquiries-fixtures";
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
            input: InquiryFixtureInput;
        };
        try {
            process.send?.({ id: m.id, value: await inquiryFixture(repo, m.input) });
        }
        catch (error) {
            process.send?.({ id: m.id, error: error instanceof Error ? error.message : "fixture failed" });
        }
    });
    const { startServer } = await import("next/dist/server/lib/start-server.js");
    await startServer({ dir: process.cwd(), hostname: "127.0.0.1", port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.INQUIRIES_MODE ?? "sqlite";
if (mode !== "mock" && mode !== "sqlite")
    throw new Error("INQUIRIES_MODE must be mock or sqlite");
function validPort(value: string | undefined, fallback: number) { const result = Number(value ?? fallback); assert(Number.isSafeInteger(result) && result > 1024 && result < 65536, "valid owned port required"); return result; }
const port = validPort(process.env.E2E_PORT, 4205), auxPort = validPort(process.env.E2E_AUX_PORT, 4206);
assert.notEqual(port, auxPort);
const runtimeRoot = path.resolve(process.env.INQUIRIES_HTTP_ROOT ?? ".local/g09-http");
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(path.join(runtimeRoot, `${mode}-`)), database = path.join(directory, "inquiries.db"), files = path.join(directory, "files"), reportFile = path.resolve(process.env.INQUIRIES_HTTP_REPORT ?? path.join(directory, "report.json"));
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
    level: "HTTP" | "DB_FIXTURE" | "PROCESS" | "SSE";
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
function check(id: string, condition: unknown, requirements = ["AC-09-01"], level: "HTTP" | "DB_FIXTURE" | "PROCESS" | "SSE" = "HTTP") { checks.push({ id, requirements, level, status: condition ? "PASS" : "FAIL" }); assert(condition, id); }
async function freePort(p: number) { await new Promise<void>((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(p, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve())); }); }
async function start(p = port) {
    await freePort(p);
    const origin = `http://127.0.0.1:${p}`, args = mode === "mock" ? ["--import", "tsx", "scripts/verify-inquiries-http.ts", "--mock-server"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(p)];
    const log = `${reportFile}.server-${processes.length + 1}.log`, output = createWriteStream(log, { mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g09_http_${p}`, E2E_PORT: String(p), OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
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
async function fixture<T>(input: InquiryFixtureInput): Promise<T> {
    if (mode === "sqlite") {
        const repo = createSqliteRepository(openDatabase(database));
        try {
            return await inquiryFixture(repo, input) as T;
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
import type { ActiveConversationDetailDTO, ConversationDetailDTO, InquiryCommandResult, InquiryEventPage, InquiryUploadResult, StaffInquiryEvent } from '@/server/inquiries/contracts';
import type { InquiryList } from '@/server/inquiries/read';
const A='ctx-jp-a-luna',brand=new Client(),gsg=new Client(),admin=new Client(),peer=new Client(),foreign=new Client();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=','base64');
const content=(body='실제 HTTP 질문',fileVersionIds:string[]=[])=>({clientMessageId:randomUUID(),body,fileVersionIds});
const url=(id:string)=>`/api/inquiries/${id}`;
const detail=(c:Client,id:string)=>c.get<ConversationDetailDTO>(url(id));
async function active(c:Client,id:string):Promise<ActiveConversationDetailDTO>{const d=await detail(c,id);assert.equal(d.phase,'active');return d as ActiveConversationDetailDTO;}
const list=(c:Client)=>c.get<InquiryList>(`/api/inquiries?context=${A}`);
async function draft(c=brand){const response=await c.mutate('/api/inquiries',{contextId:A,taskId:null,idempotencyKey:randomUUID()});assert.equal(response.status,201,await response.clone().text());return (await response.json()) as {conversationId:string;revision:number};}
async function command(c:Client,id:string,body:Record<string,unknown>){const r=await c.mutate(url(id),{idempotencyKey:randomUUID(),...body});assert.equal(r.status,200,await r.clone().text());return await r.json() as InquiryCommandResult;}
async function upload(c:Client,id:string,items:{key:string;name:string;bytes:Buffer}[],visibility='public'){
    const csrf=await c.get<{csrfToken:string}>('/api/auth/csrf'),form=new FormData();for(const item of items){form.append('files',new Blob([new Uint8Array(item.bytes)],{type:'image/png'}),item.name);form.append('clientItemIds',item.key);}
    const path=`${url(id)}/files?visibility=${visibility}`,r=await fetch(c.origin+path,{method:'POST',headers:{Cookie:c.cookie,Origin:c.origin,'X-CSRF-Token':csrf.csrfToken},body:form});await capture(r,'POST multipart',path);return r;
}
async function ready(c:Client,id:string,visibility='public',key=randomUUID()){
    const r=await upload(c,id,[{key,name:'source.png',bytes:png}],visibility);assert.equal(r.status,200,await r.clone().text());const item=(await r.json()).items[0] as InquiryUploadResult;assert.equal(item.state,'ready');if(item.state!=='ready')throw Error('ready expected');return item.file;
}
const streams:{path:string;raw:string;frames:unknown[];closed:boolean}[]=[];
async function stream(c:Client,id:string,cursor:string){
    const abort=new AbortController(),path=`${url(id)}/stream?after=${encodeURIComponent(cursor)}`,response=await fetch(c.origin+path,{headers:{Cookie:c.cookie},signal:abort.signal});assert.equal(response.status,200);
    const record={path,raw:'',frames:[] as unknown[],closed:false};streams.push(record);const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='';
    const done=(async()=>{try{while(true){const r=await reader.read();if(r.done)break;const text=decoder.decode(r.value,{stream:true});record.raw+=text;pending+=text;let end:number;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const data=frame.split('\n').find(l=>l.startsWith('data: '));if(data)record.frames.push(JSON.parse(data.slice(6)));}}}catch(error){if(!abort.signal.aborted)throw error;}finally{record.closed=true;}})();
    return {record,close:async()=>{abort.abort();await done;},wait:async(predicate:()=>boolean)=>{for(let n=0;n<120&&!predicate();n++)await new Promise(r=>setTimeout(r,50));assert(predicate(),'expected live stream frame');}};
}
function persist(name:string,value:unknown){writeFileSync(`${reportFile}.${name}.json`,JSON.stringify(value,null,2),{mode:0o600});}
let reachedEnd=false;
try {
    if(mode==='sqlite'){const db=openDatabase(database,true);migrate(db);const repo=createSqliteRepository(db);await seed(repo);repo.close();}
    await start();for(const[c,name]of[[brand,'team'],[gsg,'operator'],[admin,'admin'],[peer,'luna'],[foreign,'wave']]as const)await c.login(`${name}@example.test`);
    check('G09-H01 anonymous and wrong-CSRF rejected',(await new Client().send(`/api/inquiries?context=${A}`)).status===401&&(await brand.send('/api/inquiries','POST',{})).status===403,['A19']);
    check('G09-H02 unknown input and duplicate list query rejected',(await brand.mutate('/api/inquiries',{contextId:A,taskId:null,idempotencyKey:randomUUID(),question:'premature'})).status===422&&(await brand.send(`/api/inquiries?context=${A}&context=${A}`)).status===422,['AC-09-02']);
    const d=await draft(),id=d.conversationId,beforeDraft=await fixture<InquiryFixtureSnapshot>({conversationId:id});
    check('G09-H03 draft public denominator and facts zero',(await list(brand)).total===0&&(await list(gsg)).counts.questions===0&&beforeDraft.messages.length===0&&beforeDraft.rows.find(x=>x.kind==='inquiryEvent')!.rows.length===0,['AC-09-02']);
    check('G09-H04 private draft denied even GSG admin and same-context peer',(await gsg.send(url(id))).status===404&&(await admin.send(url(id))).status===404&&(await peer.send(url(id))).status===404,['A19']);
    const item={key:randomUUID(),name:'selected.png',bytes:png},bad={key:randomUUID(),name:'bad.png',bytes:Buffer.from('not image')},partial=await upload(brand,id,[item,bad]);assert.equal(partial.status,200);const items=(await partial.json()).items as InquiryUploadResult[];
    check('G09-H05 file partial keeps ready and explicit failed items',items[0].state==='ready'&&items[1].state==='failed',['D02','A20']);
    if(items[0].state!=='ready')throw Error('ready selected');const selected=items[0].file,unused=await ready(brand,id);
    const replayUpload=await upload(brand,id,[item]);check('G09-H06 same upload intent returns same file',(await replayUpload.json()).items[0].file.id===selected.id,['D02','A20']);
    const changed=await upload(brand,id,[{...item,name:'changed.png'}]);check('G09-H07 changed upload intent conflicts',(await changed.json()).items[0].error.code==='CONFLICT',['D02','A20']);
    check('G09-H08 draft source download and generic upload bypass denied',(await gsg.send(selected.originalUrl)).status===404&&(await brand.upload(`conversationId=${id}`,png)).status===422,['D02','A19']);
    const first={command:'publish_first',title:'G09 actual first attachment-only',expectedRevision:d.revision,content:content('',[selected.id]),idempotencyKey:randomUUID()},sent=await command(brand,id,first);
    check('G09-H09 first send same intent returns exact receipt',hash(await command(brand,id,first))===hash(sent),['AC-09-02','A20']);
    check('G09-H10 different first send cannot republish',(await brand.mutate(url(id),{...first,idempotencyKey:randomUUID(),content:content('different first')})).status===409,['A20']);
    const firstDetail=await active(gsg,id),message=firstDetail.messages[0];
    check('G09-H11 first selected file and exact immutable message reference visible',message.id===sent.messageId&&message.files.length===1&&message.files[0].id===selected.id&&hash(Buffer.from(await(await gsg.send(message.files[0].originalUrl)).arrayBuffer()).toString('base64'))===hash(png.toString('base64')),['AC-09-02','D02']);
    check('G09-H12 unrelated unused file and foreign participant denied',(await gsg.send(`/api/files/${unused.id}?conversationId=${id}&messageId=${message.id}`)).status===404&&(await peer.send(url(id))).status===404&&(await foreign.send(url(id))).status===404,['A19','D02']);
    for(let i=1;i<5;i++)await command(brand,id,{command:'question',expectedRevision:(await active(brand,id)).revision,content:content('질문 '+i)});
    let current=await active(gsg,id);for(const q of current.questions.slice(0,4))await command(gsg,id,{command:'answer',questionId:q.id,expectedQuestionRevision:q.revision,content:content('명시 답변 '+q.id)});
    current=await active(gsg,id);const waiting=current.questions.find(q=>q.state!=='resolved')!;
    await command(gsg,id,{command:'state',questionId:waiting.id,expectedQuestionRevision:waiting.revision,state:'external_waiting',reason:'외부 일정 확인',externalWait:{counterparty:'합성 외부 담당',sentAt:null,responsibleUserId:'user-gsg',nextCheckDate:'2026-10-05',timezone:'Asia/Tokyo',latestResult:'회신 대기'}});
    await command(gsg,id,{command:'message',kind:'acknowledgement',questionId:waiting.id,content:content('확인 중')});
    for(const[c,name]of[[brand,'brand'],[gsg,'gsg']]as const){const d=await active(c,id),l=await list(c);check(`G09-H13 ${name} five four one with actual summary`,hash(d.counts)===hash({questions:5,answered:4,unresolved:1,waitingGsg:0,waitingBrand:0,externalWaiting:1})&&hash(d.counts)===hash(l.counts)&&d.nextChecks[0].date==='2026-10-05',['AC-09-01']);}
    const beforeInternal=await active(brand,id),internal=await ready(gsg,id,'internal');await command(gsg,id,{command:'internal_note',questionId:null,content:content('G09_INTERNAL_MARKER',[internal.id])});
    check('G09-H14 internal message files do not change public DTO cursor revision time',hash(await active(brand,id))===hash(beforeInternal)&&!(await list(brand)).items.some(i=>JSON.stringify(i).includes('G09_INTERNAL')),['A19','AC-09-03']);
    const staffInternal=await detail(gsg,id);assert('internalMessages'in staffInternal);const internalMessage=staffInternal.internalMessages[0];
    check('G09-H15 internal exact file forbidden to brand',(await brand.send(internalMessage.files[0].originalUrl)).status===404,['D02','A19']);
    const live=await stream(brand,id,beforeInternal.cursor),liveStaff=await stream(gsg,id,(await active(gsg,id)).cursor);
    const m1=await command(gsg,id,{command:'message',kind:'comment',questionId:null,content:content('LIVE_ONE')}),m2=await command(gsg,id,{command:'message',kind:'comment',questionId:null,content:content('LIVE_TWO')});
    const has=(frames:unknown[],id:string|null)=>frames.some(f=>(f as StaffInquiryEvent).type==='message'&&'message'in(f as StaffInquiryEvent)&&(f as {message:{id:string}}).message.id===id);
    await live.wait(()=>has(live.record.frames,m1.messageId)&&has(live.record.frames,m2.messageId));await liveStaff.wait(()=>has(liveStaff.record.frames,m1.messageId)&&has(liveStaff.record.frames,m2.messageId));
    check('G09-H16 two actual actors receive same live canonical message IDs',has(live.record.frames,m1.messageId)&&has(liveStaff.record.frames,m1.messageId),['AC-09-02','AC-09-03'],'SSE');
    check('G09-H17 actual brand stream has no internal content position metadata',!live.record.raw.includes('G09_INTERNAL_MARKER')&&!live.record.raw.includes(internal.id)&&!live.record.raw.includes('publicPosition')&&!live.record.raw.includes('internalPosition'),['A19','AC-09-03'],'SSE');
    await live.close();await liveStaff.close();const offline=await active(brand,id);
    const missed:InquiryCommandResult[]=[];for(let i=0;i<2;i++)missed.push(await command(gsg,id,{command:'message',kind:'comment',questionId:null,content:content('MISSED_'+i)}));
    const catchup=await brand.get<InquiryEventPage<StaffInquiryEvent>>(`${url(id)}/events?after=${offline.cursor}`);
    check('G09-H18 disconnected catchup exactly two messages once',catchup.events.length===2&&catchup.events.every(e=>e.type==='message')&&missed.every(m=>has(catchup.events,m.messageId)),['AC-09-03']);
    check('G09-H19 advanced cursor has no duplicate events',(await brand.get<InquiryEventPage>(`${url(id)}/events?after=${catchup.cursor}`)).events.length===0,['AC-09-03']);
    const reconnected=await stream(brand,id,offline.cursor);await reconnected.wait(()=>missed.every(m=>has(reconnected.record.frames,m.messageId)));check('G09-H20 reconnect SSE exact missing two',reconnected.record.frames.length===2,['AC-09-03'],'SSE');await reconnected.close();
    check('G09-H21 actor-bound and malformed cursor rejected',(await gsg.send(`${url(id)}/events?after=${catchup.cursor}`)).status===409&&(await brand.send(`${url(id)}/events?after=bad`)).status===422,['A19','AC-09-03']);
    const send={command:'message',kind:'comment',questionId:null,content:content('LOST_RESPONSE'),idempotencyKey:randomUUID()};const sentLost=await command(brand,id,send),again=await command(brand,id,{...send,idempotencyKey:randomUUID()});
    check('G09-H22 client message identity protects lost response new intent',sentLost.messageId===again.messageId&&(await active(brand,id)).messages.filter(m=>m.clientMessageId===send.content.clientMessageId).length===1,['AC-09-03','A20']);
    check('G09-H23 changed same client body rejected',(await brand.mutate(url(id),{...send,idempotencyKey:randomUUID(),content:{...send.content,body:'different'}})).status===409,['A20']);
    const read={command:'read',throughMessageId:sentLost.messageId,idempotencyKey:randomUUID()};await command(gsg,id,read);await command(gsg,id,{...read,idempotencyKey:randomUUID()});
    check('G09-H24 read records identical canonical target once',(await active(brand,id)).reads.filter(r=>r.throughMessageId===sentLost.messageId).length===1,['AC-09-02']);
    const beforeLink=await fixture<InquiryFixtureSnapshot>({conversationId:id}),c={...blankContent(),title:'문의에서 실제 생성한 업무',description:'별도 공개 필요',deadline:{...blankContent().deadline,responsibleUserId:'user-gsg'}};
    const created=await admin.mutate('/api/tasks',{targets:[{contextId:A,ownerId:'user-gsg',assigneeId:'user-team',coAssigneeIds:[],productIds:[]}],category:'spot',content:c,idempotencyKey:randomUUID()});assert.equal(created.status,201,await created.clone().text());const taskId=(await created.json()).ids[0] as string;
    const revision=(await active(gsg,id)).revision;check('G09-H25 failed stale association preserves created task',(await gsg.mutate(url(id),{command:'link_task',taskId,expectedRevision:revision-1,idempotencyKey:randomUUID()})).status===409&&(await admin.send(`/api/tasks/${taskId}`)).status===200,['AC-09-04']);
    await command(gsg,id,{command:'link_task',taskId,expectedRevision:revision});check('G09-H26 unpublished linked task hidden without changing original messages',(await active(brand,id)).task===null&&hash((await fixture<InquiryFixtureSnapshot>({conversationId:id})).messages)===hash(beforeLink.messages),['AC-09-04']);
    const task=await admin.get<TaskDetail>(`/api/tasks/${taskId}`);const published=await admin.mutate(`/api/tasks/${taskId}`,{command:'publish',expectedRevision:task.task.revision,idempotencyKey:randomUUID()});assert.equal(published.status,200);
    check('G09-H27 task becomes navigable only after separate publication',(await active(brand,id)).task?.id===taskId&&(await gsg.get<InquiryList>(`/api/inquiries?context=${A}&task=${taskId}`)).total===1,['AC-09-04']);
    const remaining=(await active(gsg,id)).questions.find(q=>q.id===waiting.id)!;await command(gsg,id,{command:'answer',questionId:remaining.id,expectedQuestionRevision:remaining.revision,content:content('외부 일정 답변')});const resolved=await active(brand,id);
    await command(brand,id,{command:'question',expectedRevision:resolved.revision,content:content('해결 후 새 질문')});const reopened=await active(brand,id);check('G09-H28 reopen preserves previous resolution and history',reopened.lastResolvedAt===resolved.lastResolvedAt&&!!resolved.lastResolvedAt&&reopened.counts.answered===5&&reopened.counts.unresolved===1&&reopened.history.length>resolved.history.length,['AC-09-05']);
    const racer=new Client(mode==='sqlite'?auxPort:port);if(mode==='sqlite')await start(auxPort);await racer.login('team@example.test');
    const raceRev=(await active(brand,id)).revision,races=await Promise.all([brand,racer].map((actor,i)=>actor.mutate(url(id),{command:'question',expectedRevision:raceRev,content:content('CAS '+i),idempotencyKey:randomUUID()})));
    check('G09-H29 concurrent public CAS exactly one winner',races.map(r=>r.status).sort().join(',')==='200,409',['A20']);
    const uploadKey=randomUUID(),uploads=await Promise.all([brand,racer].map(actor=>upload(actor,id,[{key:uploadKey,name:'race.png',bytes:png}]))),ur=await Promise.all(uploads.map(r=>r.json()));
    check('G09-H30 concurrent per-item upload one logical file',uploads.every(r=>r.status===200)&&ur[0].items[0].state==='ready'&&ur[0].items[0].file.id===ur[1].items[0].file.id,['A20','D02']);
    const extended=await fixture<InquiryFixtureSnapshot>({conversationId:id,action:'extend'});persist('stored-extension',extended);check('G09-H31 unknown stored extension stays out of API',JSON.stringify(extended).includes('G09_STORED_EXTENSION')&&!JSON.stringify(await active(brand,id)).includes('G09_STORED_EXTENSION'),['A19']);
    const beforeRestart=await active(brand,id),saved=await fixture<InquiryFixtureSnapshot>({conversationId:id}),privateDraft=await draft(),privateFile=await ready(brand,privateDraft.conversationId);persist('before-restart',{beforeRestart,saved,privateDraft,privateFile});
    if(mode==='sqlite'){
        await stop(auxPort);await stop(port);await start();const relog=new Client();await relog.login('team@example.test');
        check('G09-H32 new PID and real relogin restore messages question history reads exact cursor',processes[0].pid!==processes.at(-1)!.pid&&hash(await active(relog,id))===hash(beforeRestart),['A20'],'PROCESS');
        check('G09-H33 old cursor still catches up after restart',(await relog.get<InquiryEventPage>(`${url(id)}/events?after=${offline.cursor}`)).events.length>0,['AC-09-03']);
        check('G09-H34 private draft and exact byte hash persist',(await detail(relog,privateDraft.conversationId)).phase==='draft'&&hash(Buffer.from(await(await relog.send(privateFile.originalUrl)).arrayBuffer()).toString('base64'))===hash(png.toString('base64')),['A20','D02']);
        check('G09-H35 original saved business facts untouched by restart',(await fixture<InquiryFixtureSnapshot>({conversationId:id})).rowsSha256===saved.rowsSha256,['A20'],'DB_FIXTURE');
        brand.cookie=relog.cookie;await gsg.login('operator@example.test');await admin.login('admin@example.test');
    }
    const revokeStream=await stream(brand,id,(await active(brand,id)).cursor),members=await admin.get<{members:{id:string;revision:number;data:{userId:string;scope:string}}[]}>(`/api/contexts/${A}/members`),member=members.members.find(m=>m.data.userId==='user-team')!;
    const revoked=await admin.mutate(`/api/contexts/${A}/members/${member.id}`,{expectedRevision:member.revision,status:'suspended',scope:member.data.scope,internalPriceAccess:false},'PATCH');assert.equal(revoked.status,200);
    await command(gsg,id,{command:'message',kind:'comment',questionId:null,content:content('AFTER_REVOKE_SECRET')});await revokeStream.wait(()=>revokeStream.record.frames.some(f=>!!(f as {error?:unknown}).error));
    check('G09-H36 current revocation terminates actual stream without new protected message',!revokeStream.record.raw.includes('AFTER_REVOKE_SECRET')&&revokeStream.record.frames.some(f=>(f as {error?:{code:string}}).error?.code==='NOT_FOUND'),['A19','D04','AC-09-03'],'SSE');await revokeStream.close();
    check('G09-H37 revoke denies details files cursor and successful intent replay',(await brand.send(url(id))).status===404&&(await brand.send(message.files[0].originalUrl)).status===404&&(await brand.send(`${url(id)}/events?after=${beforeRestart.cursor}`)).status===404&&(await brand.mutate(url(id),send)).status===404,['A19','D02','D04']);
    const malformed=await fixture({conversationId:id,action:'malform'});persist('malformed-stored',malformed);const invalid=await gsg.send(url(id));check('G09-H38 malformed known store returns safe503',invalid.status===503&&!JSON.stringify(await invalid.json()).includes('G09_MALFORMED_TITLE'),['A19']);
    reachedEnd=true;
}catch(error){failure=error instanceof Error?error.stack??error.message:'unknown failure';process.exitCode=1;}
finally{
    for(const p of [...children.keys()])await stop(p);
    persist('stream-frames',streams);const report={candidate_commit:candidate,runner_sha256:hash(readFileSync('scripts/verify-inquiries-http.ts','utf8')),fixture_runner_sha256:hash(readFileSync('scripts/verify-inquiries-fixtures.ts','utf8')),status:failure?'FAIL':'PASS',mode,cwd:process.cwd(),session_uuid:'01a0c307-c975-75b1-b96a-5a5c4e448aec',startedAt,finishedAt:new Date().toISOString(),failure,count_unit:'assertion',pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length+(failure&&!checks.some(c=>c.status==='FAIL')?1:0),skip:mode==='mock'?4:0,skipped_ids:mode==='mock'?['G09-H32','G09-H33','G09-H34','G09-H35']:[],reachedEnd,not_run:'G09 UI/HTML/RSC/home and independent acceptance remain NOT_RUN',checks,transcript,processes,resources:{port,auxPort,database,files},fixture_boundary:'Real HTTP/login/files/SSE. Mock child injects seeded repository with private IPC; SQLite uses normal Next start plus private fixture reader. No product fixture endpoint.'};
    writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,reportFile}));
}
