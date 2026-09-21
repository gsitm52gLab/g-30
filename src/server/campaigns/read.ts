import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { storedMenuState } from './state';
import type { Clock,UnitOfWork,StoredRecord } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { PublicMenu } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { physicalFactsSummary } from '@/domain/campaigns/validate';
import { safeEvaluation,providerDTO } from '@/server/submissions/projection';
import { latestSubmission,snapshotDTO } from '@/server/submissions/read';
import { taskScope } from '@/server/policy/projection';
import { decide } from '@/server/policy/policy';
import { fileMetadata,fileUrls } from '@/server/files/service';
import { visibleFile } from '@/server/files/access';
import { productDetail } from '@/server/products/read';
import { resolveProduct } from '@/server/products/access';
import { unavailable } from '@/server/auth/errors';
import { resolveCampaign,manager,campaignTask } from './access';
import { versionDTO,versionContent,metadata,selectionDTO,catalogDTO,referenceDTO } from './projection';
import { exactReference } from './targets';
import * as safe from './stored';
export function menuState(s:UnitOfWork,p:Principal,v:StoredRecord<'campaignVersion'>,menu:PublicMenu){const state=storedMenuState(s,v,menu);return {...state,selection:state.selection?selectionDTO(s,p,state.selection):null};}
export function menuProgress(s:UnitOfWork,p:Principal,v:StoredRecord<'campaignVersion'>,m:PublicMenu,clock:Clock){
 const task=campaignTask(s,p,v.data.taskId,clock),status=menuState(s,p,v,m),latest=latestSubmission(s,task),previous=latest?s.get('requestVersion',latest.data.requestId):null;
 const request={...m.request,internalOriginal:'',internalMemo:''};
 const evaluation=status.active?safeEvaluation(request,latest?.data.answers??[],previous?.data.content??request,!!latest):null;
 const physical=m.physical.map(definition=>{const facts=s.list('campaignPhysicalFact',v.contextId!).filter(r=>r.data.campaignVersionId===v.id&&menuIdentityKey(safe.identity(r.data.menu))===menuIdentityKey(m.identity)&&r.data.physicalKey===definition.key).sort((a,b)=>a.data.sequence-b.data.sequence).map(r=>{const f=safe.physical(r.data);return {...metadata(s,p,r),...f,performedBy:providerDTO(s,p,v.contextId!,f.performedBy),evidence:f.evidence.map(x=>referenceDTO(s,p,x,v.id,clock))};});return {definition,facts,...physicalFactsSummary(facts),fulfillment:'not_inferred' as const};});
 const followups=m.followups.map(definition=>{const facts=s.list('campaignFollowupFact',v.contextId!).filter(r=>r.data.campaignVersionId===v.id&&menuIdentityKey(safe.identity(r.data.menu))===menuIdentityKey(m.identity)&&r.data.followupKey===definition.key).sort((a,b)=>a.data.sequence-b.data.sequence).map(r=>({...metadata(s,p,r),source:referenceDTO(s,p,r.data.source,v.id,clock),receivedBy:providerDTO(s,p,v.contextId!,safe.provider(r.data.receivedBy)),occurredAt:safe.occurred(r.data.occurredAt),note:safe.text(r.data.note)}));return {definition,facts,status:facts.length?'received' as const:'pending' as const};});
 return {menu:m.identity,...status,evaluation,sourceSubmissionId:latest?.id??null,physical,followups,missingRequired:status.active?evaluation!.missing:0,missingFollowup:status.active?followups.filter(f=>f.status==='pending').length:0,missingReceiptObservation:status.active?physical.filter(f=>f.receiptFacts===0).length:0,reminderEligible:status.active&&!['completed','cancelled','on_hold'].includes(task.data.status)};
}
export function campaignDetail(s:UnitOfWork,p:Principal,id:string,clock:Clock,versionId?:string){
 const {row,task}=resolveCampaign(s,p,id,clock),manage=manager(s,p,task.id,clock),selectedId=versionId??row.data.currentVersionId;
 const versions=s.list('campaignVersion',row.contextId!).filter(v=>v.data.campaignId===id).sort((a,b)=>b.data.sequence-a.data.sequence),selected=selectedId?versions.find(v=>v.id===selectedId):null;if(selectedId&&!selected)unavailable();
 const all=versions.map(v=>versionDTO(s,p,v,clock)),content=selected?versionContent(selected):null;
 const selections=selected?s.list('campaignSelection',row.contextId!).filter(v=>v.data.campaignVersionId===selected.id).sort((a,b)=>b.data.sequence-a.data.sequence).map(v=>selectionDTO(s,p,v)):[];
 const external=selected?s.list('campaignExternalFact',row.contextId!).filter(v=>v.data.campaignVersionId===selected.id).sort((a,b)=>a.data.sequence-b.data.sequence).map(r=>{const f=safe.external(r.data);return {...metadata(s,p,r),menu:safe.identity(r.data.menu),axis:f.axis,value:f.value,requester:providerDTO(s,p,row.contextId!,f.requester),performedBy:providerDTO(s,p,row.contextId!,f.performedBy),occurredAt:f.occurredAt,note:f.note,...manage?{source:f.source}:{}};}):[];
 const submissions=s.list('submission',row.contextId!).filter(v=>v.data.taskId===task.id).sort((a,b)=>b.data.sequence-a.data.sequence).map(v=>snapshotDTO(s,p,v,clock));
 const draft=manage?safe.draft(row.data.draft):null,currentRequest=task.data.currentRequestId?s.get('requestVersion',task.data.currentRequestId):null;
 const publicSummary=selected?content!.menus.map(m=>menuProgress(s,p,selected,m,clock)):[];
 const providers=manage?s.list('membership',row.contextId!).filter(m=>m.data.status==='active').flatMap(m=>{const u=s.get('user',m.data.userId);return u?.data.status==='active'?[{id:u.id,label:u.data.name}]:[];}):[];
 return {id:row.id,taskId:task.id,contextId:row.contextId!,taskTitle:task.data.title,taskStatus:task.data.status,requestProjection:currentRequest?{requestId:currentRequest.id,sequence:currentRequest.data.sequence,source:campaignRequestSource(s,currentRequest),taskUrl:`/tasks/${encodeURIComponent(task.id)}?context=${encodeURIComponent(task.contextId!)}`} : null,actorId:p.user.id,revision:manage?row.revision:safe.integer(row.data.publicRevision),currentVersionId:row.data.currentVersionId,selected:all.find(v=>v.id===selectedId)??null,versions:all,selections,external,progress:publicSummary,submissions,capabilities:{manage,respond:!!selected&&selected.id===row.data.currentVersionId&&decide(s,p,'submission.write',taskScope(task),clock).allowed,recordExternal:manage,recordPhysical:!!selected&&decide(s,p,'submission.write',taskScope(task),clock).allowed,recordFollowup:!!selected&&decide(s,p,'submission.write',taskScope(task),clock).allowed},staff:manage?{draft,preview:publicDraft(draft!),publishedOriginal:selected?safe.draft(selected.data.privateDraft):null,catalogs:s.list('campaignCatalogVersion',row.contextId!).map(v=>catalogDTO(s,p,v,clock)),providers,sourceFiles:s.list('fileVersion',row.contextId!).filter(f=>f.data.taskId===task.id&&visibleFile(s,p,f,taskScope(task),clock)).map(f=>({...fileMetadata(f),...fileUrls(f,task.id)})),products:task.data.productIds.map(pid=>productDetail(s,p,resolveProduct(s,p,row.contextId!,pid,clock),clock))}:null};
}
import { publicContent as publicDraft } from './projection';
/** Synchronous caller UoW; no fake zero on a denied/corrupt relation. */
export function readCampaignRemainder(s:UnitOfWork,p:Principal,taskId:string,clock:Clock){
 const task=campaignTask(s,p,taskId,clock),rows=s.list('campaign',task.contextId!).filter(r=>r.data.taskId===task.id&&r.data.currentVersionId);
 const campaigns=rows.map(r=>{const v=s.get('campaignVersion',r.data.currentVersionId!);if(!v)unavailable();const content=versionContent(v),menus=content.menus.map(m=>menuProgress(s,p,v,m,clock));return {campaignId:r.id,campaignVersionId:v.id,selectionVersionId:menus[0]?.selection?.id??null,menus,activeMenus:menus.filter(m=>m.active).map(m=>m.menu),missingRequired:menus.reduce((n,m)=>n+m.missingRequired,0),missingFollowup:menus.reduce((n,m)=>n+m.missingFollowup,0),missingReceiptObservation:menus.reduce((n,m)=>n+m.missingReceiptObservation,0),cancellationDiscussion:menus.some(m=>m.state.cancellation==='discussion'),reminderEligible:menus.some(m=>m.reminderEligible)};});
 return {connected:true as const,taskId,campaigns,missingRequired:campaigns.reduce((n,c)=>n+c.missingRequired,0),reminderEligible:campaigns.some(c=>c.reminderEligible),notificationDeliveryConnected:false as const};
}
export function validateFollowup(s:UnitOfWork,p:Principal,v:StoredRecord<'campaignVersion'>,m:PublicMenu,key:string,source:import('@/domain/campaigns/types').SubmittedReference,clock:Clock){
 const definition=m.followups.find(f=>f.key===key);if(!definition)unavailable();const r=exactReference(s,p,source,clock),q=m.request.requirements.find(q=>q.key===definition.requirementKey)!;
 if(!source.answer||source.answer.requirementKey!==q.key||r.answer?.type!==q.type)unavailable();
 const evaluation=safeEvaluation({...m.request,internalOriginal:'',internalMemo:''},r.snapshot.content.answers,r.request.data.content),item=evaluation.items.find(i=>i.requirementKey===q.key&&i.productId===source.answer!.productId);
 if(!item||item.status!=='received'||['execution_photo','performance_report'].includes(definition.kind)&&!source.fileVersionIds.length)unavailable();return r;
}
