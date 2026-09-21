/** Historical DBs are filesystem-copied, including sidecars and files, before any SQLite open. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import path from 'node:path';
import {openDatabase,migrate} from '@/server/db/database';
import type {SubmissionSnapshot} from '@/server/submissions/contracts';
const [label,sourceDb,sourceFiles,destination]=process.argv.slice(2);assert(['g11-ui','g12-http'].includes(label)&&sourceDb&&sourceFiles&&destination,'label originalDB files newDestination required');
const cwd=process.cwd(),candidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),port=Number(process.env.E2E_PORT??4233),origin=`http://127.0.0.1:${port}`,hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex'),checks:{id:string;status:'PASS'|'FAIL'}[]=[],copies:{source:string;copy:string;sha256:string;bytes:number}[]=[],processes:object[]=[],responses:object[]=[];
let db:ReturnType<typeof openDatabase>|null=null,server:ChildProcess|undefined,closed:Promise<void>|undefined,error:string|null=null,firstOpenAt:string|null=null,copyCompletedAt:string|null=null;
const check=(id:string,ok:unknown)=>{checks.push({id,status:ok?'PASS':'FAIL'});assert(ok,id);},targetDb=path.join(destination,'upgrade.db'),files=path.join(destination,'files');
async function copy(a:string,b:string){const bytes=await readFile(a);await mkdir(path.dirname(b),{recursive:true});await copyFile(a,b);assert.equal(hash(await readFile(b)),hash(bytes));copies.push({source:a,copy:b,sha256:hash(bytes),bytes:bytes.length});}
async function tree(a:string,b:string){await mkdir(b,{recursive:true});for(const e of await readdir(a,{withFileTypes:true})){if(e.isDirectory())await tree(path.join(a,e.name),path.join(b,e.name));else if(e.isFile())await copy(path.join(a,e.name),path.join(b,e.name));}}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function start(){await new Promise<void>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(e=>e?reject(e):resolve()));});const log=path.join(destination,`server-${processes.length+1}.log`),out=createWriteStream(log);server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd,env:{...process.env,DATA_SOURCE:'sqlite',DATABASE_FILE:targetDb,FILE_STORAGE_DIR:files,APP_ORIGIN:origin,SESSION_COOKIE_NAME:`g13_history_${port}`,OPENAI_API_KEY:'',OPENAI_MODEL:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server.stdout!.pipe(out);server.stderr!.pipe(out);const child=server;processes.push({pid:child.pid,cwd,argv:['next','start','--port',String(port)],log});closed=new Promise(r=>child.on('close',(code,signal)=>{processes.push({pid:child.pid,exitCode:code,signal});out.end();r();}));for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/health')).ok)return child.pid;}catch{}if(child.exitCode!==null)throw Error('server exited');await pause(50);}throw Error('server unavailable');}
async function stop(){if(server?.exitCode===null)server.kill('SIGTERM');await closed;server=undefined;}
let cookie='';async function request(url:string,body?:unknown){const token=body===undefined?'':await csrf();const r=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...body!==undefined?{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':token}:{}},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];const bytes=Buffer.from(await r.arrayBuffer()),p=path.join(destination,'responses',`${responses.length+1}.body`);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,bytes);responses.push({url,status:r.status,path:p,sha256:hash(bytes)});assert.equal(r.status,200,bytes.toString().slice(0,500));return bytes;}
async function csrf():Promise<string>{return JSON.parse((await request('/api/auth/csrf')).toString()).csrfToken;}
type Raw={kind:string;id:string;context_id:string|null;data:string};
const planned=['copy-before-open','historical-sql-membership','historical-populated','baseline13-preserves-rows','own-migration-one','all-old-ledger-metadata','old-rows-byte-identical','repeat-zero','immutable-submission','immutable-completion-or-campaign','original-files-before','pid1-login','pid1-submission','pid1-file','pid1-schedule-create','pid1-notifications','new-pid','pid2-login','pid2-submission','pid2-file','pid2-schedule','pid2-notifications','original-files-after','sources-unchanged'];
let facts:unknown;let completed=false;
try {
 await mkdir(destination,{recursive:false});
 for(const suffix of ['','-wal','-shm']) {try{await stat(sourceDb+suffix);}catch{continue;}await copy(sourceDb+suffix,path.join(destination,'pristine','original.db'+suffix));await copy(sourceDb+suffix,targetDb+suffix);}
 await tree(sourceFiles,path.join(destination,'pristine','files'));await tree(sourceFiles,files);copyCompletedAt=new Date().toISOString();
 firstOpenAt=new Date().toISOString();db=openDatabase(targetDb);
 check('copy-before-open',copyCompletedAt<=firstOpenAt&&copies.length>=4);
 const before=db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Raw[],beforeText=JSON.stringify(before),ledger=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {name:string;sha256:string}[];
 const expected=label==='g11-ui'?[1,2,3,4,5,6,7,8,9,10,11,12]:[1,2,3,4,5,6,7,8,9,10];
 check('historical-sql-membership',JSON.stringify(ledger.map(r=>Number(r.name.slice(0,4))))===JSON.stringify(expected));check('historical-populated',before.length>50);
 // Align only the COPY with prerequisite SQL through0013, preserving historical metadata; G13 is then measured separately.
 const baselineDir=path.join(destination,'baseline-sql');await mkdir(baselineDir);for(const f of (await readdir('src/server/db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)&&Number(f.slice(0,4))<14))await copyFile(path.join('src/server/db/migrations',f),path.join(baselineDir,f));
 const baseline=migrate(db,baselineDir);check('baseline13-preserves-rows',baseline.total===13&&baseline.applied===13-expected.length&&JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all())===beforeText);
 const own=migrate(db);check('own-migration-one',own.applied===1&&own.total===14);const afterLedger=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {name:string;sha256:string}[];
 check('all-old-ledger-metadata',JSON.stringify(afterLedger.filter(r=>ledger.some(p=>p.name===r.name)))===JSON.stringify(ledger));check('old-rows-byte-identical',JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all())===beforeText);
 const repeated=migrate(db);check('repeat-zero',repeated.applied===0&&repeated.total===14);
 const sub=before.find(r=>r.kind==='submission'&&JSON.parse(r.data).fileVersionIds.length>0);assert(sub,'actual historical submitted file required');
 for(const [kind,id] of [['submission','immutable-submission'],[label==='g11-ui'?'completionSnapshot':'campaignVersion','immutable-completion-or-campaign']]) {const row=before.find(r=>r.kind===kind);assert(row,`historical ${kind} required`);let rejected=false;try{db.prepare('UPDATE records SET data=data WHERE kind=? AND id=?').run(kind,row.id);}catch{rejected=true;}check(id,rejected);}
 facts={beforeLedger:ledger,baselineAlignment:baseline,own,repeated,afterLedger,beforeRows:before.length,beforeRowsSha256:hash(beforeText)};await writeFile(path.join(destination,'before-records-private.json'),JSON.stringify(before,null,2));db.close();db=null;
 const sourceCopies=copies.filter(c=>c.source.startsWith(sourceFiles+path.sep));check('original-files-before',(await Promise.all(sourceCopies.map(async c=>hash(await readFile(c.copy))===c.sha256))).every(Boolean));
 const submission=JSON.parse(sub.data);let firstSnapshot:SubmissionSnapshot|undefined,scheduleId='',firstSchedule='',firstNotifications='',priorPid:number|undefined;
 for(let round=1;round<=2;round++) {
  const currentPid=await start();if(round===2)check('new-pid',currentPid!==priorPid);priorPid=currentPid;cookie='';await request('/api/auth/login',{email:'admin@example.test',password:'Demo-Hale-2026!'});check(`pid${round}-login`,!!cookie);
  const snapshot=JSON.parse((await request(`/api/submissions/${sub.id}`)).toString()) as SubmissionSnapshot;check(`pid${round}-submission`,snapshot.id===sub.id&&snapshot.requestId===submission.requestId&&snapshot.contentHash===submission.contentHash&&(round===1||JSON.stringify(snapshot)===JSON.stringify(firstSnapshot)));if(round===1)firstSnapshot=snapshot;
  const file=snapshot.files[0];check(`pid${round}-file`,hash(await request(file.originalUrl))===file.sha256);
  const contextId=sub.context_id!;
  if(round===1) {const result=JSON.parse((await request('/api/schedule',{command:'save',contextId,scheduleId:null,expectedRevision:0,content:{taskId:submission.taskId,title:'이전 자료를 보존하는 일정',kind:'review',visibility:'public',deadline:{value:null,precision:'date',timezone:'Asia/Seoul',certainty:'needs_confirmation',source:'합성 이행 검사',sourceVersion:'v1',responsibleUserId:'user-gsg',raw:'미확정 원문'},statements:[],conflicts:[]},reason:'',idempotencyKey:`history-${label}`})).toString());scheduleId=result.ids[0];firstSchedule=(await request(`/api/schedule/${scheduleId}`)).toString();check('pid1-schedule-create',JSON.parse(firstSchedule).current.content.deadline.value===null);
   await request('/api/notifications/sync',{contextId});firstNotifications=(await request(`/api/notifications?context=${contextId}`)).toString();check('pid1-notifications',Array.isArray(JSON.parse(firstNotifications).items));
  } else {check('pid2-schedule',(await request(`/api/schedule/${scheduleId}`)).toString()===firstSchedule);check('pid2-notifications',(await request(`/api/notifications?context=${contextId}`)).toString()===firstNotifications);}
  await stop();
 }
 check('original-files-after',(await Promise.all(sourceCopies.map(async c=>hash(await readFile(c.copy))===c.sha256))).every(Boolean));
 check('sources-unchanged',(await Promise.all(copies.map(async c=>hash(await readFile(c.source))===c.sha256))).every(Boolean));completed=true;
} catch(e) {error=e instanceof Error?e.stack??e.message:String(e);process.exitCode=1;}
finally {db?.close();await stop();await writeFile(path.join(destination,'report.json'),JSON.stringify({candidate,cwd,label,sourceDb,sourceFiles,sourceOpened:false,copyCompletedAt,firstOpenAt,copies,checks:checks.map(c=>({...c,requirements:['AC-13-01','AC-13-03','A20'],level:'HISTORICAL_DB_HTTP'})),processes,responses,error,facts,completed,providerCalls:0,counts:{unit:'assertion',pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length,execution_failure:error&&!checks.some(c=>c.status==='FAIL')?1:0,skip:0,not_run:planned.filter(id=>!checks.some(c=>c.id===id))}},null,2));console.log(JSON.stringify({report:path.join(destination,'report.json'),pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length,error}));}
