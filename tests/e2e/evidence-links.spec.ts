import {test,expect,request as apiRequest,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {blankContent,blankRequirement,type RequestContent} from '@/domain/tasks/types';
import {blankCommon,blankFileBinding} from '@/domain/products/types';
import {blankDraft,type AnswerInput} from '@/domain/submissions/types';
import type {ProductDetail} from '@/server/products/service';
import type {TaskDetail} from '@/server/tasks/service';
import type {SubmissionWorkspace,SubmissionSnapshot} from '@/server/submissions/contracts';
import {referenceHref,type SubmissionReference} from '@/features/submissions/reference';
const contextId='ctx-jp-a-luna';
const origin=()=>`http://127.0.0.1:${process.env.E2E_PORT}`;
test.use({actionTimeout:10000});
async function get<T>(r:APIRequestContext,url:string):Promise<T>{const response=await r.get(url);expect(response.status(),url).toBe(200);return response.json();}
async function post<T>(r:APIRequestContext,url:string,data:unknown,status=200):Promise<T>{const csrf=await get<{csrfToken:string}>(r,'/api/auth/csrf');const response=await r.post(url,{data,headers:{Origin:origin(),'X-CSRF-Token':csrf.csrfToken}});expect(response.status(),`${url}: ${await response.text()}`).toBe(status);return response.json();}
async function login(r:APIRequestContext,email:string){await post(r,'/api/auth/login',{email,password:'Demo-Hale-2026!'});}
const workspace=(r:APIRequestContext,id:string)=>get<SubmissionWorkspace>(r,`/api/tasks/${id}/submissions`);
async function command(r:APIRequestContext,id:string,command:string,extra:Record<string,unknown>={}){const t=await get<TaskDetail>(r,`/api/tasks/${id}`);return post(r,`/api/tasks/${id}`,{command,expectedRevision:t.task.revision,idempotencyKey:randomUUID(),...extra});}
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+ZkAAAAASUVORK5CYII=','base64');
async function fixture(page:Page){
 await login(page.request,'admin@example.test');
 const admin=await apiRequest.newContext({baseURL:origin(),storageState:await page.context().storageState()});
 try{
 const products:string[]=[];for(const name of ['A','B']){const created=await post<{ids:string[]}>(admin,'/api/products',{contextId,brandId:'brand-luna',common:{...blankCommon(),name:`링크 상품 ${name}`,code:`LINK-${randomUUID()}`},idempotencyKey:randomUUID()},201);products.push(created.ids[0]);}
 const csrf=await get<{csrfToken:string}>(admin,'/api/auth/csrf');const uploaded=await admin.post(`/api/files?contextId=${contextId}&productId=${products[0]}`,{headers:{Origin:origin(),'X-CSRF-Token':csrf.csrfToken},multipart:{visibility:'public',files:{name:'원문-S1.png',mimeType:'image/png',buffer:bytes}}});expect(uploaded.status()).toBe(201);const fileId=(await uploaded.json()).files[0].id as string;
 const product=await get<ProductDetail>(admin,`/api/products/${products[0]}?context=${contextId}`),binding={...blankFileBinding('exact-binding',fileId),title:'원문 자료 S1',documentType:'제품 목록',productIds:products};
 await post(admin,`/api/products/${products[0]}`,{contextId,command:'save_files',files:[binding],expectedContextRevision:product.contextRevision,idempotencyKey:randomUUID()});
 const content:RequestContent={...blankContent(),title:`과거 자료 ${randomUUID().slice(0,8)}`,description:'R1 요청 원문',requirements:[{...blankRequirement('common','long_text'),label:'같은 표시명'},{...blankRequirement('scoped','long_text'),label:'같은 표시명',productIds:products},{...blankRequirement('document','file'),label:'제출 원문'}]};content.deadline.responsibleUserId='user-gsg';
 const created=await post<{ids:string[]}>(admin,'/api/tasks',{category:'spot',content,targets:[{contextId,ownerId:'user-gsg',assigneeId:'user-luna',coAssigneeIds:['user-co'],productIds:products}],idempotencyKey:randomUUID()},201),taskId=created.ids[0];await command(admin,taskId,'publish');
 await login(page.request,'luna@example.test');
 async function submit(version:number){const w=await workspace(page.request,taskId);const answers:AnswerInput[]=[{requestId:w.request.id,requirementKey:'common',productId:null,type:'long_text',input:{text:`공통 S${version}`}},{requestId:w.request.id,requirementKey:'document',productId:null,type:'file',input:{fileVersionIds:[fileId]}},...products.map((productId,i)=>({requestId:w.request.id,requirementKey:'scoped',productId,type:'long_text' as const,input:{text:`상품 ${i===0?'A':'B'} S${version}`}}))];
 const body={...blankDraft(),narrative:`확정 본문 S${version}`,answers,artifacts:[{fileVersionId:fileId,role:'evidence',answer:{requirementKey:'document',productId:null}}],productSelections:w.products.map(p=>({productId:p.productId,expectedCommonRevision:p.commonRevision,expectedContextRevision:p.contextRevision,bindingIds:p.bindings.map(b=>b.id),retailPriceVersionId:null,asOfDate:'2026-09-21'}))};
 await post(page.request,`/api/tasks/${taskId}/submission-draft`,{command:'save',baseRequestId:w.request.id,expectedDraftRevision:w.draft?.revision??0,content:body,idempotencyKey:randomUUID()});const saved=await workspace(page.request,taskId);
 const result=await post<{ids:string[]}>(page.request,`/api/tasks/${taskId}/submissions`,{baseRequestId:saved.request.id,expectedDraftRevision:saved.draft!.revision,expectedTaskRevision:saved.taskRevision,mode:'full',idempotencyKey:randomUUID()},201);return get<SubmissionSnapshot>(page.request,`/api/submissions/${result.ids[0]}`);}
 const s1=await submit(1);content.description='R2 요청 원문';await command(admin,taskId,'save',{content});await command(admin,taskId,'publish');const changed=await workspace(page.request,taskId);await post(page.request,`/api/tasks/${taskId}/submission-draft`,{command:'rebase_apply',baseRequestId:s1.requestId,targetRequestId:changed.request.id,expectedDraftRevision:changed.draft!.revision,carryAnswers:[],idempotencyKey:randomUUID()});const s2=await submit(2);
 expect(s1.requestId).not.toBe(s2.requestId);expect(s1.products.find(p=>p.productId===products[0])!.files[0].fileVersionId).toBe(fileId);
 const target:SubmissionReference={taskId,contextId,requestId:s1.requestId,submissionId:s1.id,requirementKey:'common',productId:null};
 return {taskId,products,fileId,s1,s2,target};
 }finally{await admin.dispose();}
}
const panel=(p:Page)=>p.getByRole('region',{name:'링크로 선택한 과거 자료',exact:true});
const selected=(p:Page)=>panel(p).getByRole('article',{name:'링크로 선택한 답변',exact:true});
async function selectHistory(page:Page,target:SubmissionReference){await page.evaluate(url=>window.history.pushState(null,'',url),referenceHref(target));}
test.beforeEach(async({page})=>{await page.context().tracing.start({screenshots:true,snapshots:true,sources:true});});
test.afterEach(async({page},info)=>{await writeFile(info.outputPath('final-dom-private.html'),await page.content());await page.screenshot({path:info.outputPath(info.status===info.expectedStatus?'final-private.png':'failure-private.png'),fullPage:true});await page.context().tracing.stop({path:info.outputPath('journey-private-trace.zip')});});

test('LINK-01 SA21/28/29 D09 actual R1S1 file/product exact focus and query history preserve dirty editor',async({page},info)=>{
 test.setTimeout(70000);const f=await fixture(page);await writeFile(info.outputPath('actual-producer-private.json'),JSON.stringify(f,null,2));const before=await get<TaskDetail>(page.request,`/api/tasks/${f.taskId}`);let mutations=0;page.on('request',r=>{if(r.method()==='POST')mutations++;});
 await page.goto(referenceHref(f.target));await expect(selected(page)).toContainText('공통 S1');await expect(selected(page)).toBeFocused();await expect(panel(page)).toContainText('R1 요청 원문');await expect(panel(page)).not.toContainText('확정 본문 S2');await expect(page.getByRole('region',{name:'제출 이력',exact:true})).toBeHidden();
 const rect=await selected(page).boundingBox();expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeLessThan(page.viewportSize()!.height);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('selected-answer-viewport-private.png'),fullPage:false});
 const downloaded=await page.request.get(f.s1.files[0].downloadUrl);expect(downloaded.status()).toBe(200);expect(createHash('sha256').update(await downloaded.body()).digest('hex')).toBe(f.s1.files[0].sha256);expect(mutations).toBe(0);const after=await get<TaskDetail>(page.request,`/api/tasks/${f.taskId}`);expect(after.task.revision).toBe(before.task.revision);expect(after.activities).toEqual(before.activities);
 await panel(page).getByRole('button',{name:'자료 링크 닫고 현재 업무 보기',exact:true}).click();const editor=page.getByRole('region',{name:'답변 편집',exact:true}),input=editor.getByRole('textbox',{name:'제출할 때 전할 말',exact:true});await input.fill('보존할 미저장 입력');
 await page.getByRole('button',{name:'제출 v1 보기 · 전체',exact:true}).click();const s1=page.getByRole('region',{name:'제출 v1 상세',exact:true});await s1.getByRole('article').filter({hasText:'상품 B S1'}).getByRole('link',{name:'이 답변의 정확한 링크',exact:true}).click();await expect(selected(page)).toContainText('상품 B S1');await expect(input).toHaveValue('보존할 미저장 입력');await expect(selected(page)).toBeFocused();
 await selectHistory(page,{...f.target,requirementKey:'scoped',productId:f.products[0]});await expect(selected(page)).toContainText('상품 A S1');await expect(input).toHaveValue('보존할 미저장 입력');await page.goBack();await expect(selected(page)).toContainText('상품 B S1');await page.goForward();await expect(selected(page)).toContainText('상품 A S1');await expect(input).toHaveValue('보존할 미저장 입력');expect(mutations).toBe(0);
 await panel(page).getByRole('button',{name:'자료 링크 닫고 현재 업무 보기',exact:true}).click();await editor.getByRole('button',{name:'답변 임시 저장',exact:true}).click();await expect(editor.getByRole('status').filter({hasText:'답변을 임시 저장했습니다.'})).toBeVisible();await page.reload();await expect(page.getByRole('textbox',{name:'제출할 때 전할 말',exact:true})).toHaveValue('보존할 미저장 입력');expect((await workspace(page.request,f.taskId)).history).toHaveLength(2);
});

test('LINK-02 SA21/29 exact invalid duplicate missing foreign or absent address never selects latest',async({page},info)=>{
 test.setTimeout(80000);const f=await fixture(page);const urls=[...['contextId','requestId','submissionId','requirementKey','productId','taskId'].map(k=>referenceHref({...f.target,[k]:'unavailable'})),referenceHref({...f.target,requirementKey:'scoped',productId:null}),referenceHref({...f.target,productId:f.products[0]})];
 for(const key of ['productId','submissionId','context']){const u=new URL(referenceHref(f.target),origin());u.searchParams.delete(key);urls.push(u.pathname+u.search);const duplicate=new URL(referenceHref(f.target),origin());duplicate.searchParams.append(key,duplicate.searchParams.get(key)!);urls.push(duplicate.pathname+duplicate.search);}
 const results=[];for(const url of urls){await page.goto(url);await expect(page.getByRole('alert').filter({hasText:'지정한 자료를 열 수 없습니다'})).toBeVisible();await expect(page.getByRole('region',{name:/제출 v[12] 상세/})).toHaveCount(0);results.push({url,status:'PASS'});}await writeFile(info.outputPath('negative-addresses-private.json'),JSON.stringify(results,null,2));
 await page.goto(referenceHref(f.target));await expect(selected(page)).toContainText('공통 S1');
});

test('LINK-03 SA21/28/29 stale response retry read-only teammate and fresh permission loss',async({page},info)=>{
 test.setTimeout(80000);const f=await fixture(page);await login(page.request,'team@example.test');await page.goto(`/tasks/${f.taskId}?context=${contextId}`);await expect(page.getByRole('region',{name:'답변 편집',exact:true})).toHaveCount(0);
 let release!:()=>void,arrived!:()=>void;const pending=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrived=r;});
 await page.route(`**/api/submissions/${f.s1.id}`,async route=>{const response=await route.fetch();arrived();await pending;await route.fulfill({response});},{times:1});await selectHistory(page,f.target);await started;await selectHistory(page,{...f.target,requestId:f.s2.requestId,submissionId:f.s2.id});await expect(selected(page)).toContainText('공통 S2');release();await expect(selected(page)).toContainText('공통 S2');await expect(panel(page)).not.toContainText('확정 본문 S1');
 await page.route(`**/api/submissions/${f.s1.id}`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'합성 조회 실패'}})}),{times:1});await selectHistory(page,f.target);await expect(panel(page).getByRole('alert')).toBeVisible();await expect(panel(page).getByRole('region',{name:/제출 v[12] 상세/})).toHaveCount(0);await panel(page).getByRole('button',{name:'지정 자료 다시 조회',exact:true}).click();await expect(selected(page)).toContainText('공통 S1');await expect(page.getByRole('region',{name:'답변 편집',exact:true})).toHaveCount(0);expect((await page.request.get(f.s1.files[0].downloadUrl)).status()).toBe(200);
 await writeFile(info.outputPath('team-exact-private.json'),JSON.stringify({submissionId:f.s1.id,fileVersionId:f.fileId,historyCount:(await workspace(page.request,f.taskId)).history.length},null,2));await post(page.request,'/api/auth/logout',{});await selectHistory(page,{...f.target,productId:f.products[0],requirementKey:'scoped'});await expect(panel(page).getByRole('alert')).toBeVisible();await expect(page.getByRole('region',{name:/제출 v[12] 상세/})).toHaveCount(0);expect((await page.request.get(`/api/submissions/${f.s1.id}`)).status()).toBe(401);expect((await page.request.get(f.s1.files[0].downloadUrl)).status()).toBe(401);
});
