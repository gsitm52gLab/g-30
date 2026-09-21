import {expect,type Page} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {json,mutation,ctx} from './campaigns-ui';
import type {SubmissionWorkspace,SubmissionSnapshot,UploadResult} from '@/server/submissions/contracts';
import type {ProductDetail} from '@/server/products/service';
export async function campaignPdfSubmission(page:Page,taskId:string){
 let w=await json<SubmissionWorkspace>(page.request,`/api/tasks/${taskId}/submissions`);
 expect(w.products.map(p=>p.productId)).toEqual(['product-serum']);
 const bytes=await readFile('tests/fixtures/ai-input/native-12.pdf'),csrf=await(await page.request.get('/api/auth/csrf')).json();
 const uploaded=await page.request.post(`/api/tasks/${taskId}/submission-files?requestId=${w.request.id}`,{multipart:{clientItemIds:randomUUID(),files:{name:'native-12.pdf',mimeType:'application/pdf',buffer:bytes}},headers:{Origin:`http://127.0.0.1:${process.env.E2E_PORT}`,'X-CSRF-Token':csrf.csrfToken}});
 expect(uploaded.status(),await uploaded.text()).toBe(200);const item=(await uploaded.json()).items[0] as UploadResult;expect(item.state).toBe('ready');if(item.state!=='ready')throw Error('Actual PDF upload failed');
 const p=await json<ProductDetail>(page.request,`/api/products/product-serum?context=${ctx}`),content={answers:[{requestId:w.request.id,requirementKey:'proof',productId:null,type:'file',input:{fileVersionIds:[item.file.id]}},{requestId:w.request.id,requirementKey:'url',productId:null,type:'link',input:{url:'https://example.test/published',description:'합성 게시 URL',contentFixed:false,fixedReference:null}}],narrative:'G12 메뉴 선택의 실제 PDF 제출',links:[],artifacts:[{fileVersionId:item.file.id,role:'evidence',answer:{requirementKey:'proof',productId:null}}],productSelections:[{productId:p.productId,expectedCommonRevision:p.commonRevision,expectedContextRevision:p.contextRevision,bindingIds:[],retailPriceVersionId:null,asOfDate:'2026-09-21'}]};
 const saved=await mutation(page.request,`/api/tasks/${taskId}/submission-draft`,{command:'save',baseRequestId:w.request.id,expectedDraftRevision:w.draft?.revision??0,content,idempotencyKey:randomUUID()});expect(saved.status(),await saved.text()).toBe(200);
 w=await json(page.request,`/api/tasks/${taskId}/submissions`);const submitted=await mutation(page.request,`/api/tasks/${taskId}/submissions`,{baseRequestId:w.request.id,expectedDraftRevision:w.draft!.revision,expectedTaskRevision:w.taskRevision,mode:'full',idempotencyKey:randomUUID()});expect(submitted.status(),await submitted.text()).toBe(201);
 const snapshot=await json<SubmissionSnapshot>(page.request,`/api/submissions/${(await submitted.json()).ids[0]}`);expect(snapshot.products).toHaveLength(1);expect(snapshot.products[0].productId).toBe(p.productId);return{snapshot,sha256:createHash('sha256').update(bytes).digest('hex')};
}
