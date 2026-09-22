import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { chromium, expect as baseExpect, request } from '@playwright/test';
import { parsePostgresConfig, createPostgresRepository } from '@/server/postgres';
import { migratePostgres } from '@/server/postgres/migrate';
import { seed } from '@/server/db/seed';
import { IdentityService } from '@/server/auth/service';
import { HomeService } from '@/server/home/service';
import { InquiryService } from '@/server/inquiries/service';
import { createHomeFixtures, A, B, type HomeActors } from './verify-home-fixtures';
import type { HomeDTO } from '@/server/home/contracts';
import { BRAND } from '@/domain/brand';
const cwd = process.cwd(), schema = 'gs_hale_g03_20260922', port = 4483, origin = `http://127.0.0.1:${port}`;
const envFile = path.resolve(process.env.GS_HALE_ENV_FILE || '.env'), digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex'), envBefore = digest(readFileSync(envFile));
const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env, DATA_SOURCE: 'supabase', SUPABASE_DB_SCHEMA: schema };
const config = parsePostgresConfig(env, 'migration'), repo = createPostgresRepository(config), identity = new IdentityService(repo), home = new HomeService(identity);
const root = path.resolve(process.env.HOME_REPORT_DIR || `.local/g03-proof/${randomUUID()}`); mkdirSync(root, { recursive: true, mode: 0o700 });
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const checks: { id: string; status: string; ms: number; error?: string }[] = [], processes: { pid?: number; stopped: boolean }[] = [];
const expect = baseExpect.configure({ timeout: 60000 });
let server: ChildProcess | null = null, actor: HomeActors, fixture: Awaited<ReturnType<typeof createHomeFixtures>>, initial: HomeDTO;
const prefix = `G03_${randomUUID().replaceAll('-', '').slice(0,12)}`;
function save() { writeFileSync(path.join(root, 'result.json'), JSON.stringify({ candidate, dirty, cwd, schema, prefix, fixture, checks, processes, envUnchanged: digest(readFileSync(envFile)) === envBefore, attachmentFlow: 'NOT_RUN: pending accepted app Storage', rawSecretsEmitted: false }, null, 2), { mode: 0o600 }); }
async function check(id: string, run: () => Promise<void>) { const started = performance.now(); try { await run(); checks.push({ id, status: 'PASS', ms: Math.round(performance.now() - started) }); } catch(e) { checks.push({ id, status: 'FAIL', ms: Math.round(performance.now() - started), error: e instanceof assert.AssertionError ? 'ASSERTION' : e && typeof e === 'object' && 'code' in e ? String(e.code).replace(/[^A-Z0-9_]/g,'').slice(0,50) : 'CHECK_FAILED' }); save(); throw e; } save(); console.log(JSON.stringify(checks.at(-1))); }
async function start() {
  const log = createWriteStream(path.join(root, `server-${processes.length}.log`), { flags: 'wx', mode: 0o600 });
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, stdio: ['ignore','pipe','pipe'], env: { ...env, APP_ORIGIN: origin, SESSION_COOKIE_NAME: 'g03_home_proof', FILE_STORAGE_DIR: path.join(root,'files'), IMPORT_STORAGE_DIR: path.join(root,'imports'), OPENAI_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1' } });
  server.stdout!.pipe(log, { end: false }); server.stderr!.pipe(log, { end: false }); server.once('close', () => log.end()); processes.push({ pid: server.pid, stopped: false });
  for(let i=0;i<150;i++) { if(server.exitCode!==null) throw Error('SERVER_START'); try { if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)return; } catch{} await new Promise(r=>setTimeout(r,100)); } throw Error('READINESS');
}
async function stop() { if(!server)return; if(server.exitCode===null && server.signalCode===null) { const stopped=new Promise<void>(r=>server!.once('close',()=>r())); server.kill('SIGTERM'); await stopped; } processes.findLast(p=>p.pid===server!.pid)!.stopped=true; server=null; }
try {
  await check('PG01 additive17 migrations, seed and real login', async()=>{ assert.equal((await migratePostgres(config)).total,17); await seed(repo); const login=async(email:string)=>(await identity.login(undefined,{email,password:'Demo-Hale-2026!'})).token; actor={admin:await login('admin@example.test'),brand:await login('luna@example.test'),gsg:await login('operator@example.test'),team:await login('team@example.test'),co:await login('co@example.test')}; initial=await home.read(actor.gsg,{scope:'context',context:A}); });
  await check('PG02 actual typed task/question/submission/correction/completion/notice fixtures',async()=>{fixture=await createHomeFixtures(identity,actor,prefix);});
  await check('PG03 exact count deltas and assignments; foreign/price/query denial',async()=>{
    const staff=await home.read(actor.gsg,{scope:'context',context:A}),brand=await home.read(actor.brand,{scope:'context',context:A});
    for(const [key,n]of Object.entries({today:1,near:1,overdue:1,externalChecks:1,unresolved:1,newSubmissions:1,handoffChecks:1,corrections:1,confirmation:2,unreadNotices:1}))assert.equal(staff.counts[key as keyof HomeDTO['counts']]-initial.counts[key as keyof HomeDTO['counts']],n);
    const one=staff.tasks.find(t=>t.id===fixture.todayTask)!,two=brand.tasks.find(t=>t.id===fixture.todayTask)!; assert.deepEqual(one.assignees,two.assignees);assert.deepEqual(one.owner,two.owner);assert.deepEqual(one.deadline,two.deadline);assert.equal(two.remaining,1);
    assert(!JSON.stringify(brand).includes('G03_PRIVATE_OPINION'));assert(!JSON.stringify(brand).includes('internalSupply'));assert(!brand.tasks.some(t=>t.id===fixture.foreign));
    assert(staff.questions.some(q=>q.id===fixture.questionId&&q.url.endsWith(`#question-${fixture.questionId}`)));
    await assert.rejects(home.read(actor.team,{scope:'all',context:B}),{status:404});
    assert.equal((await home.read(actor.team,{scope:'mine'})).tasks.length,0);
  });
  await check('PG04 second connection durable read and rolled-back update absent',async()=>{
    const second=createPostgresRepository(parsePostgresConfig(env));try{const other=new HomeService(new IdentityService(second));assert.deepEqual((await other.read(actor.brand,{scope:'context',context:A})).counts,(await home.read(actor.brand,{scope:'context',context:A})).counts);}finally{await second.close();}
    const row=(await repo.get('task',fixture.todayTask))!;await assert.rejects(repo.transaction(async s=>{await s.update('task',row.id,row.revision,{...row.data,title:'G03_ROLLBACK_TITLE'});throw Error('synthetic abort');}));assert.equal((await home.read(actor.gsg,{scope:'context',context:A})).tasks.find(t=>t.id===row.id)!.title,row.data.title);
  });
  await start();
  const browser=await chromium.launch();
  try { for(const viewport of [{width:1280,height:900},{width:390,height:844}]) await check(`UI${viewport.width} role menu, canonical views, exact question anchor and keyboard`,async()=>{
    const context=await browser.newContext({viewport}),page=await context.newPage();context.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);await context.addCookies([{name:'g03_home_proof',value:actor.brand,url:origin}]);await context.tracing.start({screenshots:true,snapshots:true,sources:true});
    try {
      await page.goto(origin+`/?scope=context&context=${A}`);await expect(page.getByRole('heading',{name:BRAND.slogan,exact:true})).toBeVisible();
      for(const label of ['상품정보','PR·행사','약기법 사전검토','자료함·제출표'])await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:label})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:/운영 설정/})).toHaveCount(0);
      assert.deepEqual(await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})),{client:viewport.width,scroll:viewport.width});
      await page.screenshot({path:path.join(root,`home-${viewport.width}.png`),fullPage:true});
      for(const name of ['칸반','프로젝트 타임라인','목록']) { await page.getByRole('link',{name,exact:true}).click(); await expect(page.locator(`[data-home-task="${fixture.todayTask}"]`)).toBeVisible(); }
      const link=page.locator(`#home-questions a[href$="#question-${fixture.questionId}"]`);await link.focus();await page.keyboard.press('Enter');await expect(page.locator(`#question-${fixture.questionId}`)).toBeFocused();
      await page.getByRole('button',{name:'질문 5 보완 작성',exact:true}).focus();await page.keyboard.press('Enter');await page.getByLabel('메시지 내용',{exact:true}).fill(`G03 키보드 확인 ${viewport.width}`);
      await expect(page.getByLabel('메시지 내용',{exact:true})).toHaveValue(`G03 키보드 확인 ${viewport.width}`);await page.screenshot({path:path.join(root,`question-${viewport.width}.png`),fullPage:true});
      // No file upload claim: Storage app acceptance is an explicit subsequent dependency.
    }finally{await context.tracing.stop({path:path.join(root,`trace-${viewport.width}.zip`)});await context.close();}
  }); }finally{await browser.close();}
  await check('PG05 API persists after server restart/relogin; answer reduces exactly one question',async()=>{
    await stop();await start();const api=await request.newContext({baseURL:origin});try{
      const csrf=await api.get('/api/auth/csrf');assert.equal(csrf.status(),200);const c=await csrf.json();assert.equal((await api.post('/api/auth/login',{headers:{Origin:origin,'X-CSRF-Token':c.csrfToken},data:{email:'operator@example.test',password:'Demo-Hale-2026!'}})).status(),200);
      const before=await api.get(`/api/home?scope=context&context=${A}`,{timeout:120000});assert.equal(before.status(),200);const b=await before.json() as HomeDTO;assert(b.questions.some(q=>q.id===fixture.questionId));
      const inquiries=new InquiryService(identity),d=await inquiries.detail(actor.gsg,fixture.conversationId);if(d.phase!=='active')throw Error();const q=d.questions.find(q=>q.id===fixture.questionId)!;
      await inquiries.command(actor.gsg,d.id,{command:'answer',questionId:q.id,expectedQuestionRevision:q.revision,content:{clientMessageId:randomUUID(),body:'실제 저장한 마지막 합성 답변',fileVersionIds:[]},idempotencyKey:randomUUID()});
      const after=await api.get(`/api/home?scope=context&context=${A}`,{timeout:120000});assert.equal(after.status(),200);const a=await after.json() as HomeDTO;assert.equal(a.counts.unresolved,b.counts.unresolved-1);assert.equal(a.counts.externalChecks,b.counts.externalChecks-1);
    }finally{await api.dispose();}
  });
  await check('PG06 revoke own synthetic session denies API without cached home',async()=>{
    await identity.logout(actor.team);const denied=await fetch(origin+`/api/home?scope=all`,{headers:{Cookie:`g03_home_proof=${actor.team}`}});assert.equal(denied.status,401);
  });
} catch { process.exitCode=1; }
finally {await stop();await repo.close();save();console.log(JSON.stringify({report:path.join(root,'result.json'),passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL').length,attachment:'NOT_RUN'}));}
