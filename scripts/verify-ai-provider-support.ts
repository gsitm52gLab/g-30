/** Author test orchestration. Faults intercept only the child process's OpenAI fetch; no product test endpoint. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { parseAiConfig } from '@/server/config/parse';
import { DEMO_PASSWORD } from '@/domain/catalog';
import { SYNTHETIC_TEXT } from '@/server/ai-input/provenance';
import type { AiContent, AiInputDetail } from '@/server/ai-input/contracts';
import type { AiReviewWorkspace, AiReviewDetail } from '@/server/ai-review/contracts';
export const ctx = 'ctx-jp-a-luna', sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export async function free(port: number) { await new Promise<void>((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(e => e ? reject(e) : resolve())); }); }
export const faultLoader = String.raw `
const fs=require('node:fs'),crypto=require('node:crypto');const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(!url.startsWith('https://api.openai.com/v1/'))return original(input,init);
const cfg=JSON.parse(fs.readFileSync(process.env.G17_FAULT_CONTROL,'utf8')),body=JSON.parse(String(init.body));const count=fs.existsSync(process.env.G17_FAULT_CALLS)?fs.readFileSync(process.env.G17_FAULT_CALLS,'utf8').trim().split('\n').filter(Boolean).length:0;
const id='resp_fault_'+process.pid+'_'+count;fs.appendFileSync(process.env.G17_FAULT_CALLS,JSON.stringify({at:new Date().toISOString(),pid:process.pid,mode:cfg.mode,responseId:id,requestHash:crypto.createHash('sha256').update(String(init.body)).digest('hex'),request:body})+'\n',{mode:0o600});
if(cfg.mode==='timeout')return new Promise((_,reject)=>{const stop=()=>reject(new DOMException('synthetic timeout','AbortError'));if(init.signal.aborted)stop();else init.signal.addEventListener('abort',stop,{once:true});});
if(cfg.gate)while(!fs.existsSync(cfg.gate))await new Promise(r=>setTimeout(r,30));
if(cfg.delayMs)await new Promise(r=>setTimeout(r,cfg.delayMs));
if(Number.isInteger(cfg.status))return new Response(JSON.stringify({error:{message:'SYNTHETIC_FAULT_KEY_MUST_NOT_LEAK',type:'synthetic'}}),{status:cfg.status,headers:{'content-type':'application/json','x-request-id':'req_fault_'+count}});
let findings=[];if(cfg.mode==='finding'){const payload=JSON.parse(body.input[0].content[0].text),seg=payload.segments[0],term='肌',start=seg.text.indexOf(term);findings=[{category:'EV-01',original:{segmentId:seg.id,start,end:start+term.length,quote:term},risk:'unknown',confidence:null,reason:'合成候補。근거 부족을 사람이 확인합니다.',additionalInformation:['실제 문맥 확인'],suggestion:null,citations:[]}];}
const raw=cfg.mode==='parse'?'NOT_JSON':JSON.stringify({schemaVersion:'gs-hale-ai-review/1',findings});const content=cfg.mode==='refusal'?[{type:'refusal',refusal:'Synthetic refusal'}]:[{type:'output_text',text:raw,annotations:[]}];
return new Response(JSON.stringify({id,object:'response',created_at:1,model:body.model,service_tier:'default',status:cfg.mode==='incomplete'?'incomplete':'completed',output:[{type:'message',role:'assistant',content}],usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200,cache_write_tokens:300},output_tokens:100,output_tokens_details:{reasoning_tokens:20},total_tokens:1100}}),{headers:{'content-type':'application/json','x-request-id':'req_fault_'+count}});
};
`;
export class ProviderHarness {
    readonly cwd = process.cwd();
    readonly candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    readonly directory: string;
    readonly database: string;
    readonly files: string;
    readonly control: string;
    readonly calls: string;
    readonly loader: string;
    readonly processes: {
        pid?: number;
        port: number;
        argv: string[];
        log: string;
        stopped?: boolean;
    }[] = [];
    readonly transcript: {
        url: string;
        method: string;
        status: number;
        path: string;
        sha256: string;
    }[] = [];
    private children = new Map<number, ChildProcess>();
    constructor(readonly root: string, readonly mode: 'mock' | 'sqlite', readonly port: number) { mkdirSync(root, { recursive: true }); this.directory = mkdtempSync(path.join(root, mode + '-')); this.database = path.join(this.directory, 'data.db'); this.files = path.join(this.directory, 'files'); this.control = path.join(this.directory, 'fault-control.json'); this.calls = path.join(this.directory, 'fault-calls.jsonl'); this.loader = path.join(this.directory, 'fault-loader.cjs'); writeFileSync(this.loader, faultLoader, { mode: 0o600 }); this.fault({ mode: 'success' }); }
    fault(value: Record<string, unknown>) { writeFileSync(this.control, JSON.stringify(value), { mode: 0o600 }); }
    async setup() { if (this.mode === 'sqlite') {
        const db = openDatabase(this.database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        (await repo.close());
    } }
    async start(kind: 'fault' | 'missing' | 'live' = 'fault', port = this.port) {
        await free(port);
        const origin = `http://127.0.0.1:${port}`;
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'production', LANG: process.env.LANG, TZ: 'Asia/Seoul', DATA_SOURCE: this.mode, DATABASE_FILE: this.database, FILE_STORAGE_DIR: this.files, IMPORT_STORAGE_DIR: path.join(this.directory, 'imports'), APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g17_${port}`, NEXT_TELEMETRY_DISABLED: '1', OPENAI_API_KEY: kind === 'fault' ? 'SYNTHETIC_FAULT_KEY_MUST_NOT_LEAK' : '', OPENAI_MODEL: 'gpt-6-astra', OPENAI_BASE_URL: 'https://api.openai.com/v1', G17_FAULT_CONTROL: this.control, G17_FAULT_CALLS: this.calls };
        if (kind === 'live') {
            const values = parseEnv(readFileSync(path.resolve(process.env.AI_PROVIDER_ENV_FILE ?? '.env'), 'utf8')), configured = parseAiConfig(values);
            assert(configured.apiKey && configured.model, 'live configuration incomplete');
            env.OPENAI_API_KEY = configured.apiKey;
            env.OPENAI_MODEL = configured.model;
            env.OPENAI_BASE_URL = configured.baseURL;
            writeFileSync(path.join(this.directory, 'safe-live-config.json'), JSON.stringify({ model: configured.model, baseURL: configured.baseURL, keyPresent: true, at: new Date().toISOString() }), { mode: 0o600 });
        }
        const args = [...(kind === 'fault' ? ['--require', this.loader] : []), 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], log = path.join(this.directory, `server-${this.processes.length + 1}.log`), out = createWriteStream(log, { mode: 0o600 }), child = spawn(process.execPath, args, { cwd: this.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        this.children.set(port, child);
        this.processes.push({ pid: child.pid, port, argv: [process.execPath, ...args], log });
        child.stdout!.pipe(out, { end: false });
        child.stderr!.pipe(out, { end: false });
        child.once('exit', () => out.end());
        for (let i = 0; i < 200; i++) {
            if (child.exitCode !== null)
                throw Error('owned server exited');
            try {
                if ((await fetch(origin + '/api/health')).ok)
                    return;
            }
            catch { }
            await sleep(50);
        }
        throw Error('server readiness');
    }
    async stop(port = this.port) { const child = this.children.get(port); if (!child)
        return; const done = new Promise<void>(r => child.once('exit', () => r())); child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null)
        await done; this.processes.find(p => p.pid === child.pid)!.stopped = true; this.children.delete(port); await free(port); }
    async stopAll() { for (const p of [...this.children.keys()])
        await this.stop(p); }
    async capture(r: Response, method: string, url: string) { const bytes = Buffer.from(await r.clone().arrayBuffer()), target = path.join(this.directory, 'responses', `${String(this.transcript.length + 1).padStart(4, '0')}.body`); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes, { mode: 0o600 }); this.transcript.push({ url, method, status: r.status, path: target, sha256: sha(bytes) }); }
    client(port = this.port) { return new ProviderClient(this, port); }
}
export class ProviderClient {
    cookie = '';
    constructor(readonly harness: ProviderHarness, readonly port: number) { }
    get origin() { return `http://127.0.0.1:${this.port}`; }
    async send(url: string, method = 'GET', body?: unknown, csrf = '') { const r = await fetch(this.origin + url, { method, redirect: 'manual', headers: { Cookie: this.cookie, ...method !== 'GET' ? { 'Content-Type': 'application/json', Origin: this.origin, 'X-CSRF-Token': csrf } : {} }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.get('set-cookie'))
        this.cookie = r.headers.get('set-cookie')!.split(';')[0]; await this.harness.capture(r, method, url); return r; }
    async get<T>(url: string) { const r = await this.send(url); assert.equal(r.status, 200, `GET ${url} status${r.status}`); return r.json() as Promise<T>; }
    async mutate(url: string, body: unknown, method = 'POST') { const { csrfToken } = await this.get<{
        csrfToken: string;
    }>('/api/auth/csrf'); return this.send(url, method, body, csrfToken); }
    async ok<T>(url: string, body: unknown, method = 'POST') { const r = await this.mutate(url, body, method); assert([200, 201].includes(r.status), `${method} ${url} status${r.status}`); return r.json() as Promise<T>; }
    async login(email = 'operator@example.test') { await this.ok('/api/auth/login', { email, password: DEMO_PASSWORD }); }
}
export function content(text = SYNTHETIC_TEXT): AiContent { return { title: 'G17 approved synthetic review', scope: { classification: 'general_cosmetic', language: 'ja', media: 'pop', use: '合成テスト' }, kind: 'text', text, sources: [], selectedPages: [], submission: null, products: [] }; }
export async function prepare(brand: ProviderClient, gsg: ProviderClient, c = content()) { const input = await brand.ok<AiInputDetail>('/api/ai-input', { contextId: ctx, visibility: 'context', content: c, idempotencyKey: randomUUID() }), extraction = await brand.ok<{
    runId: string;
}>(`/api/ai-input/${input.id}/extract`, { versionId: input.version.id, expectedRunId: null, idempotencyKey: randomUUID() }), w = await gsg.get<AiReviewWorkspace>(`/api/ai-review/inputs/${input.id}`); return { input, body: { inputVersionId: input.version.id, extractionRunId: extraction.runId, expectedRunId: w.runs[0]?.id ?? null, corpusReleaseId: w.corpus.id, corpusManifestHash: w.corpus.manifestHash, engine: 'provider', idempotencyKey: randomUUID() } }; }
export function providerStart(c: ProviderClient, f: Awaited<ReturnType<typeof prepare>>) { return c.ok<{
    runId: string;
    detail: AiReviewDetail;
}>(`/api/ai-review/inputs/${f.input.id}/start`, f.body); }
