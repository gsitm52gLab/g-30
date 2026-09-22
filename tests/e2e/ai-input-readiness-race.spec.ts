import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {AiInputDetail} from '@/server/ai-input/contracts';
import {api,post,login,ctx,content,synthetic,create,extract,open,tracing,suspend} from '../fixtures/ai-input-ui';

tracing();
const button=(page:Page)=>page.getByRole('button',{name:'외부 전송 대상 여부 확인',exact:true});
const status=(page:Page)=>page.getByRole('status').filter({hasText:/등록된 합성 자료임을 확인했습니다|외부 전송 대상이 아닙니다/});
const version=(page:Page,n:number)=>page.getByRole('heading',{name:`저장된 입력 v${n}`,exact:true});
const history=(page:Page,n:number)=>page.getByRole('navigation',{name:'입력 버전'}).getByRole('link',{name:new RegExp(`^v${n}( · 현재)?$`)});
const url=(id:string,versionId?:string)=>`/ai-input/${id}?context=${ctx}${versionId?`&version=${versionId}`:''}`;
type Held={status:number;body:unknown;requestBody:string|null;url:string;delivered:boolean};
type Gate={path:string;method:string;versionId?:string;claimed:boolean;release?:()=>void;held?:Held;fail?:boolean};
type Browser=Window&{raceGates:Record<string,Gate>;raceWrites:{url:string;body:string|null}[];lateRaceLeaks:string[]};

// Observe the real response body before pausing delivery; no response body is fabricated.
async function instrument(page:Page){
 await page.evaluate(()=>{
  const w=window as unknown as Browser,original=window.fetch.bind(window);w.raceGates={};w.raceWrites=[];
  window.fetch=async(input,init)=>{
   const address=new URL(input instanceof Request?input.url:String(input),location.href),method=init?.method??(input instanceof Request?input.method:'GET');
   if(method==='POST'&&address.pathname.startsWith('/api/ai-input'))w.raceWrites.push({url:address.href,body:typeof init?.body==='string'?init.body:null});
   const gate=Object.values(w.raceGates).find(g=>!g.claimed&&g.path===address.pathname&&g.method===method&&(g.versionId===undefined||g.versionId===address.searchParams.get('versionId')));
   if(gate)gate.claimed=true;
   const response=await original(input,init);
   if(gate){gate.held={status:response.status,body:await response.clone().json(),requestBody:typeof init?.body==='string'?init.body:null,url:address.href,delivered:false};await new Promise<void>(resolve=>{gate.release=resolve;});gate.held.delivered=true;if(gate.fail)throw new TypeError('deterministic transport loss after actual response');}
   return response;
  };
 });
}
async function hold(page:Page,name:string,path:string,method='GET',versionId?:string,fail=false){await page.evaluate(args=>{(window as unknown as Browser).raceGates[args.name]={...args,claimed:false};},{name,path,method,versionId,fail});}
async function arrived(page:Page,name:string){await expect.poll(()=>page.evaluate(n=>(window as unknown as Browser).raceGates[n]?.held?.status,name)).toBe(200);return page.evaluate(n=>(window as unknown as Browser).raceGates[n].held!,name);}
async function release(page:Page,name:string){await page.evaluate(n=>(window as unknown as Browser).raceGates[n].release!(),name);await expect.poll(()=>page.evaluate(n=>(window as unknown as Browser).raceGates[n].held?.delivered,name)).toBe(true);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function artifact(page:Page,info:TestInfo,name:string){await writeFile(info.outputPath(`${name}.json`),JSON.stringify(await page.evaluate(()=>({gates:Object.fromEntries(Object.entries((window as unknown as Browser).raceGates).map(([key,g])=>[key,g.held])),writes:(window as unknown as Browser).raceWrites})),null,2));}
async function geometry(page:Page,info:TestInfo,name:string){
 const configured=page.viewportSize()!;
 const measured=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth,dpr:devicePixelRatio,controls:[...document.querySelectorAll('main h1, main button, main input, main select, main textarea')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent?.slice(0,80),left:r.left,right:r.right};})}));
 const png=await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:true});
 await writeFile(info.outputPath(`${name}-geometry.json`),JSON.stringify({configured,...measured,pngWidth:png.readUInt32BE(16)},null,2));
 expect(measured.inner).toBe(configured.width);expect(measured.scroll).toBeLessThanOrEqual(configured.width+1);expect(png.readUInt32BE(16)).toBe(configured.width*measured.dpr);
 for(const rect of measured.controls){expect(rect.left).toBeGreaterThanOrEqual(-1);expect(rect.right).toBeLessThanOrEqual(configured.width+1);}
}
async function pair(knownFirst:boolean){
 const r=await api('luna@example.test'),v1=await create(r,content(knownFirst?synthetic:'未登録の合成文 v1')),run1=await extract(r,v1);
 const v2=await post(r,`/api/ai-input/${v1.id}/versions`,{expectedRevision:v1.revision,content:content(knownFirst?'未登録の合成文 v2':synthetic),idempotencyKey:randomUUID()}) as AiInputDetail,run2=await extract(r,v2);
 return {r,v1,v2,run1,run2};
}

for(const knownFirst of [false,true])test(`G15-R01 ${knownFirst?'unknown to known':'known to unknown'} actual held GET and readiness delivery stay bound to selection`,async({page},info)=>{
 const {r,v1,run1,run2}=await pair(knownFirst);await login(page,'luna@example.test');await open(page,v1.id);await instrument(page);
 await button(page).click();await expect(status(page)).toContainText(knownFirst?'외부 전송 대상이 아닙니다':'등록된 합성 자료임을 확인했습니다');
 await hold(page,'selected-get',`/api/ai-input/${v1.id}`,'GET',v1.version.id);
 await history(page,1).click();const heldGet=await arrived(page,'selected-get');expect(heldGet.body).toMatchObject({version:{id:v1.version.id},runs:[{id:run1.runId}]});
 await expect(button(page)).toBeDisabled();await expect(page.getByRole('button',{name:'새 버전 저장',exact:true})).toBeDisabled();await expect(status(page)).toHaveCount(0);await expect(page.getByRole('region',{name:'저장된 입력',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as Browser).raceWrites.length)).toBe(1);await geometry(page,info,'pending-selected-version');
 await release(page,'selected-get');await expect(version(page,1)).toBeVisible();await button(page).click();await expect(status(page)).toContainText(knownFirst?'등록된 합성 자료임을 확인했습니다':'외부 전송 대상이 아닙니다');
 expect(await page.evaluate(()=>(window as unknown as Browser).raceWrites.map(w=>JSON.parse(w.body!).runId))).toEqual([run2.runId,run1.runId]);
 // An already selected link must not leave the screen permanently loading.
 await history(page,1).click();await expect(button(page)).toBeEnabled();
 await page.goBack();await expect(version(page,2)).toBeVisible();await expect(status(page)).toHaveCount(0);await page.goForward();await expect(version(page,1)).toBeVisible();
 await hold(page,'old-readiness',`/api/ai-input/${v1.id}/transfer-readiness`,'POST');await button(page).click();const held=await arrived(page,'old-readiness');expect(held.body).toMatchObject({allowed:knownFirst,providerCalled:false,analysisConnected:false});expect(JSON.parse(held.requestBody!).runId).toBe(run1.runId);
 await history(page,2).click();await expect(version(page,2)).toBeVisible();await release(page,'old-readiness');await expect(status(page)).toHaveCount(0);await artifact(page,info,'actual-version-response-gates');await geometry(page,info,'late-response-new-selection');
 await page.reload();await expect(version(page,2)).toBeVisible();await button(page).click();await expect(status(page)).toContainText(knownFirst?'외부 전송 대상이 아닙니다':'등록된 합성 자료임을 확인했습니다');
 await page.goto(url(v1.id,v1.version.id));await expect(version(page,1)).toBeVisible();await button(page).click();await expect(status(page)).toContainText(knownFirst?'등록된 합성 자료임을 확인했습니다':'외부 전송 대상이 아닙니다');await r.dispose();
});

test('G15-R02 changed URL dispatch guard precedes effects; failed actual GET cannot use old readiness extract or save',async({page},info)=>{
 const {r,v1,v2}=await pair(false);await login(page,'luna@example.test');await open(page,v1.id);await instrument(page);await expect(button(page)).toBeEnabled();
 await hold(page,'failed-selected-get',`/api/ai-input/${v1.id}`,'GET',v1.version.id,true);
 const before=await page.evaluate(target=>{const w=window as unknown as Browser,ready=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='외부 전송 대상 여부 확인')!,save=document.querySelector('main form')!;const enabled=!ready.disabled;window.history.pushState(null,'',target);ready.click();save.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return {enabled,url:location.href,writes:w.raceWrites.length};},url(v1.id,v1.version.id));expect(before.enabled).toBe(true);expect(before.writes).toBe(0);
 await arrived(page,'failed-selected-get');await release(page,'failed-selected-get');await expect(page.locator('main').getByRole('alert')).toBeVisible();await expect(button(page)).toBeDisabled();await expect(page.getByRole('button',{name:'새 버전 저장',exact:true})).toBeDisabled();await expect(status(page)).toHaveCount(0);expect(await page.evaluate(()=>(window as unknown as Browser).raceWrites)).toEqual([]);await geometry(page,info,'failed-load-no-old-controls');await artifact(page,info,'pre-effect-readiness-save-guard');
 await page.getByRole('button',{name:'서버에서 새로 확인',exact:true}).click();await expect(version(page,1)).toBeVisible();await button(page).click();await expect(status(page)).toContainText('외부 전송 대상이 아닙니다');
 const v3=await post(r,`/api/ai-input/${v1.id}/versions`,{expectedRevision:v2.revision,content:content('未読の合成文 v3'),idempotencyKey:randomUUID()}) as AiInputDetail;
 await page.goto(url(v1.id,v3.version.id));await expect(version(page,3)).toBeVisible();await instrument(page);await expect(page.getByRole('button',{name:'저장한 입력 읽기',exact:true})).toBeEnabled();await hold(page,'unread-to-history',`/api/ai-input/${v1.id}`,'GET',v1.version.id);
 const readBefore=await page.evaluate(target=>{const read=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='저장한 입력 읽기')!,form=document.querySelector('main form')!,enabled=!read.disabled;window.history.pushState(null,'',target);read.click();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return {enabled,writes:(window as unknown as Browser).raceWrites.length};},url(v1.id,v1.version.id));expect(readBefore).toEqual({enabled:true,writes:0});await arrived(page,'unread-to-history');await expect(page.getByRole('button',{name:'저장한 입력 읽기',exact:true})).toBeDisabled();await release(page,'unread-to-history');await expect(version(page,1)).toBeVisible();expect(await page.evaluate(()=>(window as unknown as Browser).raceWrites)).toEqual([]);await artifact(page,info,'pre-effect-extract-save-guard');await r.dispose();
});

test('G15-R03 late actual readiness 200 cannot restore status or recovery after current authorization denial',async({page},info)=>{
 const r=await api('luna@example.test'),admin=await api(),v1=await create(r);await extract(r,v1);await login(page,'luna@example.test');await open(page,v1.id);await instrument(page);
 await hold(page,'revoked-readiness',`/api/ai-input/${v1.id}/transfer-readiness`,'POST');await button(page).click();const held=await arrived(page,'revoked-readiness');expect(held.body).toMatchObject({allowed:true,providerCalled:false,analysisConnected:false});
 try{
  await suspend(admin,'suspended');await page.getByRole('button',{name:'서버에서 새로 확인',exact:true}).click();await expect(page.getByRole('region',{name:'저장된 입력',exact:true})).toHaveCount(0);await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await page.evaluate(()=>{const w=window as unknown as Browser;w.lateRaceLeaks=[];new MutationObserver(()=>{const text=document.querySelector('main')?.textContent??'';if(text.includes('등록된 합성 자료임을 확인했습니다')||text.includes('외부 전송 대상이 아닙니다'))w.lateRaceLeaks.push(text);}).observe(document.querySelector('main')!,{subtree:true,childList:true,characterData:true});});
  await release(page,'revoked-readiness');await expect(status(page)).toHaveCount(0);await expect(page.getByRole('textbox',{name:'입력 제목',exact:true})).toHaveCount(0);
  const state=await page.evaluate(()=>({leaks:(window as unknown as Browser).lateRaceLeaks,recovery:Object.keys(sessionStorage).filter(k=>k.startsWith('gs-hale.ai-input.v1:'))}));expect(state).toEqual({leaks:[],recovery:[]});await writeFile(info.outputPath('late-authority-state.json'),JSON.stringify(state,null,2));await artifact(page,info,'actual-revoked-readiness');await geometry(page,info,'revoked-readiness');
 }finally{await suspend(admin,'active');await r.dispose();await admin.dispose();}
});
