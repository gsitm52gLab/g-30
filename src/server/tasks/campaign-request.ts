import type { Clock,UnitOfWork,StoredRecord } from '@/domain/records';
import type { CampaignRequestSource,RequestContent,Requirement } from '@/domain/tasks/types';
import type { Principal } from '@/server/auth/service';
import { content as parseContent } from '@/domain/tasks/validate';
import { fail,unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { newId,audit } from '@/server/products/store';
import { canReferenceFile } from '@/server/files/access';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { storedMenuState } from '@/server/campaigns/state';
import * as safe from '@/server/campaigns/stored';
function conflict():never{return fail('CAMPAIGN_REQUEST_CONFLICT',409,'업무 요청 또는 메뉴 조건이 변경되었습니다. 기존 요청·답변을 유지하고 GSG가 메뉴와 요청 범위를 다시 확인해 주세요.');}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Positive projection plus exact immutable relations, including the actual recorder. */
export function campaignRequestSource(s:UnitOfWork,r:StoredRecord<'requestVersion'>):CampaignRequestSource|null{
 const x=r.data.source;if(x===undefined)return null;
 if(!x||x.kind!=='campaign_selection'||typeof x.noMaterials!=='boolean'||!Number.isSafeInteger(x.eventSequence)||x.eventSequence<1)unavailable();
 const strings=(v:unknown):string[]=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string')||new Set(v).size!==v.length)unavailable();return [...v];};
 const text=(v:unknown):string=>{if(typeof v!=='string'||!v)unavailable();return v;};
 const nullable=(v:unknown)=>v===null?null:text(v);
 const result:CampaignRequestSource={kind:'campaign_selection',campaignId:text(x.campaignId),campaignVersionId:text(x.campaignVersionId),selectionVersionId:nullable(x.selectionVersionId),sourceFactId:nullable(x.sourceFactId),originalRequestId:text(x.originalRequestId),actorId:text(x.actorId),eventSequence:x.eventSequence,activeMenuKeys:strings(x.activeMenuKeys),retainedCancellationMenuKeys:strings(x.retainedCancellationMenuKeys),retainedRequirementKeys:strings(x.retainedRequirementKeys),materialProductIds:strings(x.materialProductIds),noMaterials:x.noMaterials};
 const v=s.get('campaignVersion',result.campaignVersionId),base=s.get('requestVersion',result.originalRequestId),t=s.get('task',r.data.taskId),sel=result.selectionVersionId?s.get('campaignSelection',result.selectionVersionId):null,fact=result.sourceFactId?s.get('campaignExternalFact',result.sourceFactId):null;
 if(!v||v.contextId!==r.contextId||v.data.taskId!==r.data.taskId||v.data.campaignId!==result.campaignId||v.data.requestId!==base?.id||base.data.taskId!==r.data.taskId||r.data.publishedBy!==result.actorId||!s.get('user',result.actorId)||!t||result.materialProductIds.some(id=>!t.data.productIds.includes(id))||result.noMaterials!==(r.data.content.requirements.length===0))unavailable();
 if(result.selectionVersionId&&(!sel||sel.data.campaignVersionId!==v.id||sel.data.sequence>result.eventSequence)||result.sourceFactId&&(!fact||fact.data.campaignVersionId!==v.id||fact.data.sequence!==result.eventSequence))unavailable();
 if(!fact&&(sel?.data.recordedBy??v.data.recordedBy)!==result.actorId||fact&&fact.data.recordedBy!==result.actorId)unavailable();
 return result;
}
export function materialProductIds(s:UnitOfWork,task:StoredRecord<'task'>,request:StoredRecord<'requestVersion'>){return campaignRequestSource(s,request)?.materialProductIds??task.data.productIds;}
/** Existing derived requests refer back to their GSG-approved basis, never the private task draft. */
export function campaignPublicationBasis(s:UnitOfWork,task:StoredRecord<'task'>,campaignId:string,draftRequestId:string|null){
 const current=task.data.currentRequestId?s.get('requestVersion',task.data.currentRequestId):null;if(!current)conflict();
 const source=campaignRequestSource(s,current);if(source&&source.campaignId!==campaignId)conflict();
 const saved=draftRequestId?s.get('requestVersion',draftRequestId):null,savedSource=saved?campaignRequestSource(s,saved):null;
 if(draftRequestId!==current.id&&draftRequestId!==source?.originalRequestId&&(!savedSource||savedSource.campaignId!==campaignId||savedSource.originalRequestId!==source?.originalRequestId))conflict();
 return source?s.get('requestVersion',source.originalRequestId)!:current;
}
/** No route exposes this writer. It derives content from stored, approved definitions inside the caller UoW. */
export function applyCampaignRequest(s:UnitOfWork,p:Principal,version:StoredRecord<'campaignVersion'>,clock:Clock,action:'publish'|'participate'|'external',factId:string|null){
 const task=s.get('task',version.data.taskId);if(!task||task.contextId!==version.contextId)unavailable();
 authorize(s,p,action==='participate'?'submission.write':'task.manage',taskScope(task),clock);
 const current=task.data.currentRequestId?s.get('requestVersion',task.data.currentRequestId):null,original=s.get('requestVersion',version.data.requestId);if(!current||!original)conflict();
 const prior=campaignRequestSource(s,current);
 if(current.id!==original.id&&(!prior||prior.campaignId!==version.data.campaignId||prior.originalRequestId!==original.id))conflict();
 if(action!=='publish'&&prior?.campaignVersionId!==version.id)conflict();
 if(action==='publish'&&prior){const old=s.get('campaignVersion',prior.campaignVersionId);if(!old)conflict();if(old.data.menus.some(m=>{const state=storedMenuState(s,old,safe.publicMenu(m)).state;return ['applied','withdrawal_requested'].includes(state.application)&&state.cancellation!=='cancelled';}))conflict();}
 // A task has one published campaign scope at a time. Never erase another campaign's requirements.
 if(s.list('campaign',task.contextId!).some(c=>c.id!==version.data.campaignId&&c.data.taskId===task.id&&c.data.currentVersionId))conflict();
 const menus=version.data.menus.map(safe.publicMenu),states=menus.map(m=>storedMenuState(s,version,m)),allKeys=new Set<string>(),definitions=new Map<string,Requirement>();
 for(const m of menus)for(const q of m.request.requirements){const old=definitions.get(q.key);if(old&&!same(old,q))conflict();definitions.set(q.key,q);allKeys.add(q.key);}
 const base=safe.requestContent(original.data.content),general=base.requirements.filter(q=>!allKeys.has(q.key)),active=menus.filter((_,i)=>states[i].active),retained=menus.filter((_,i)=>states[i].retainedForCancellationReview);
 const activeKeys=new Set(active.flatMap(m=>m.request.requirements.map(q=>q.key))),requirements=[...general,...[...definitions.values()].filter(q=>activeKeys.has(q.key))];
 if(requirements.some(q=>q.condition&&!requirements.some(parent=>parent.key===q.condition!.key)))conflict();
 let content:RequestContent;try{content=parseContent({...base,requirements});}catch{conflict();}
 const ownedProducts=new Set(menus.flatMap(m=>m.products.map(x=>x.productId))),products=requirements.length?[...new Set([...task.data.productIds.filter(id=>!ownedProducts.has(id)),...general.flatMap(q=>q.productIds),...active.flatMap(m=>m.products.map(p=>p.productId))])]:[];
 const selection=states[0]?.selection??null,fact=factId?s.get('campaignExternalFact',factId):null;
 const source:CampaignRequestSource={kind:'campaign_selection',campaignId:version.data.campaignId,campaignVersionId:version.id,selectionVersionId:selection?.id??null,sourceFactId:fact?.id??null,originalRequestId:original.id,actorId:p.user.id,eventSequence:fact?.data.sequence??selection?.data.sequence??version.data.sequence,activeMenuKeys:active.map(m=>menuIdentityKey(m.identity)),retainedCancellationMenuKeys:retained.map(m=>menuIdentityKey(m.identity)),retainedRequirementKeys:[...new Set(retained.flatMap(m=>m.request.requirements.map(q=>q.key)))],materialProductIds:products,noMaterials:requirements.length===0};
 if(action==='external'&&prior&&same(current.data.content,content)&&same(prior.activeMenuKeys,source.activeMenuKeys)&&same(prior.retainedCancellationMenuKeys,source.retainedCancellationMenuKeys)&&same(prior.materialProductIds,products))return current.id;
 for(const id of content.referenceFileIds){const f=s.get('fileVersion',id);if(!f||f.data.visibility!=='public')unavailable();canReferenceFile(s,p,f,taskScope(task),clock);}
 const oldKeys=current.data.content.requirements.map(q=>q.key),changedKeys=[...new Set([...oldKeys,...requirements.map(q=>q.key)])].filter(key=>!same(current.data.content.requirements.find(q=>q.key===key),requirements.find(q=>q.key===key)));
 const r=s.create('requestVersion',{id:newId(),contextId:task.contextId,data:{taskId:task.id,sequence:current.data.sequence+1,previousId:current.id,templateVersionId:current.data.templateVersionId,content,publishedBy:p.user.id,publishedAt:clock(),changedKeys,source}});
 s.update('task',task.id,task.revision,{...task.data,currentRequestId:r.id,status:['in_progress','partial','submitted'].includes(task.data.status)?'requested':task.data.status,...['on_hold','cancelled'].includes(task.data.status)?{resumeStatus:'requested' as const}:{}});
 audit(s,p,clock,task.contextId!,'task.campaign_request',task.id,{requestId:current.id},{requestId:r.id,campaignVersionId:version.id,selectionVersionId:selection?.id??null});
 s.create('domainEvent',{id:newId(),contextId:task.contextId,data:{eventType:'TASK_REQUEST_REVISED',targetId:task.id,sourceVersionId:r.id,actorId:p.user.id,at:clock()}});
 return r.id;
}
