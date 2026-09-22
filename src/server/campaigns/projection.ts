import type { Clock,UnitOfWork,StoredRecord } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { CampaignDraft,PublicMenu } from '@/domain/campaigns/types';
import { projectedRequest } from '@/server/tasks/projection';
import { userLabel } from '@/server/submissions/access';
import { providerDTO } from '@/server/submissions/projection';
import { canReferenceFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { unavailable } from '@/server/auth/errors';
import { fileMetadata } from '@/server/files/service';
import { exactReference,productTarget,sourceFiles } from './targets';
import { campaignTask } from './access';
import * as safe from './stored';
export function publicContent(d:CampaignDraft){return {title:d.title,menus:d.menus.map((m):PublicMenu=>({identity:m.identity,conditions:{state:m.conditions.state,publicExplanation:m.conditions.publicExplanation,cost:m.conditions.cost,discount:m.conditions.discount,points:m.conditions.points,cancellationTerms:m.conditions.cancellationTerms,schedules:m.conditions.schedules},templateVersionId:m.templateVersionId,request:projectedRequest(m.request,false,m.request.referenceFileIds),products:m.products,physical:m.physical,followups:m.followups,confirmationIssues:m.conflicts.map(c=>({field:c.field,state:c.state}))}))};}
export function metadata(s:UnitOfWork,p:Principal,row:{id:string;contextId:string|null;data:{sequence:number;previousId:string|null;recordedBy:string;recordedAt:string}}){return {id:safe.text(row.id),sequence:safe.integer(row.data.sequence,1),previousId:safe.nullableText(row.data.previousId),recordedAt:safe.text(row.data.recordedAt),recorderLabel:userLabel(s,p,row.contextId!,safe.text(row.data.recordedBy))};}
export function versionContent(row:StoredRecord<'campaignVersion'>){if(!Array.isArray(row.data.menus))safe.corrupt();return {title:safe.text(row.data.title),menus:row.data.menus.map(safe.publicMenu)};}
export function versionDTO(s:UnitOfWork,p:Principal,row:StoredRecord<'campaignVersion'>,clock:Clock){
 const task=campaignTask(s,p,row.data.taskId,clock),content=versionContent(row);
 const request=s.get('requestVersion',safe.text(row.data.requestId));if(!request||request.data.taskId!==task.id)unavailable();
 for(const menu of content.menus){menu.products.forEach(x=>productTarget(s,p,task,x,clock));for(const id of menu.request.referenceFileIds){const file=s.get('fileVersion',id);if(!file||file.data.visibility!=='public'||!request.data.content.referenceFileIds.includes(id))unavailable();canReferenceFile(s,p,file,taskScope(task),clock);}}
 return {...metadata(s,p,row),campaignId:safe.text(row.data.campaignId),taskId:task.id,contextId:task.contextId!,requestId:safe.text(row.data.requestId),contentHash:safe.text(row.data.contentHash),...content};
}
export function catalogDTO(s:UnitOfWork,p:Principal,row:StoredRecord<'campaignCatalogVersion'>,clock:Clock){const source=safe.sourceText(row.data.source);sourceFiles(s,p,row.contextId!,source.fileVersionIds,clock);return {...metadata(s,p,row),catalogId:safe.text(row.data.catalogId),title:safe.text(row.data.title),versionLabel:safe.text(row.data.versionLabel),source};}
export function selectionDTO(s:UnitOfWork,p:Principal,row:StoredRecord<'campaignSelection'>){
 const d=row.data;if(!['participate','decline','discuss'].includes(d.response)||!Array.isArray(d.selectedMenus))safe.corrupt();
 return {...metadata(s,p,row),campaignVersionId:safe.text(d.campaignVersionId),response:d.response,selectedMenus:d.selectedMenus.map(safe.identity),providedBy:providerDTO(s,p,row.contextId!,safe.provider(d.providedBy)),note:safe.text(d.note)};
}
export function referenceDTO(s:UnitOfWork,p:Principal,input:import('@/domain/campaigns/types').SubmittedReference,versionId:string,clock:Clock){
 const r=exactReference(s,p,input,clock),query=new URLSearchParams({context:r.snapshot.contextId,request:r.reference.requestId,submission:r.reference.submissionId,...r.reference.answer?{key:r.reference.answer.requirementKey,product:r.reference.answer.productId??''}:{}});
 return {...r.reference,submissionSequence:r.snapshot.sequence,taskUrl:`/tasks/${encodeURIComponent(r.reference.taskId)}?${query}`,files:r.reference.fileVersionIds.map(id=>{const f=s.get('fileVersion',id)!;const base=`/api/campaigns/files/${encodeURIComponent(id)}?versionId=${encodeURIComponent(versionId)}&submissionId=${encodeURIComponent(r.row.id)}`;return {...fileMetadata(f),originalUrl:base+'&mode=original',downloadUrl:base+'&mode=download',previewUrl:f.data.preview?base+'&mode=preview':null};}),products:r.reference.productUseIds.map(id=>r.snapshot.products.find(x=>x.id===id)!)};
}
