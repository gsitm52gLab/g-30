import { storedText,storedCount,storedHash,storedId } from './stored';
import type { AiContent } from '@/domain/ai-input/records';
import type { ExtractionRequest, SourceIdentity } from '@/domain/ai-input/types';
import type { IdentityService, Principal } from '@/server/auth/service';
import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import { AuthError, fail } from '@/server/auth/errors';
import { FileService } from '@/server/files/service';
import { submissionTask } from '@/server/submissions/access';
import { canReferenceFile } from '@/server/files/access';
import { taskScope } from '@/server/policy/projection';
import { readProductUse } from '@/server/products/capture';
import { resolveProduct } from '@/server/products/access';
import { contextAccess, resolveVersion, assetAccess } from './access';
import { assetDTO, AiAssets, fileDirectory } from './assets';
import { contentHash } from './extraction';
export function sourceIdentities(s:UnitOfWork,version:StoredRecord<'aiVersion'>,c:AiContent):SourceIdentity[]{return c.kind==='text'?[{sourceId:version.data.inputId,versionId:version.id,contextId:version.contextId!,sha256:contentHash(c.text!)}]:c.sources.map(ref=>{if(ref.kind==='upload'){const a=s.get('aiAsset',ref.assetId)!;return{sourceId:a.id,versionId:a.id,contextId:a.contextId!,sha256:storedHash(a.data.sha256)};}const f=s.get('fileVersion',ref.fileVersionId)!;return{sourceId:f.id,versionId:f.id,contextId:f.contextId!,sha256:storedHash(f.data.sha256)};});}
export async function loadRequest(identity:IdentityService,token:string|undefined,inputId:string,versionId:string,directory=fileDirectory()):Promise<ExtractionRequest>{
 const r=await identity.repo.transaction(s=>{const r=resolveVersion(s,identity.principal(s,token),inputId,versionId,identity.clock);return{...r,identities:sourceIdentities(s,r.version,r.content)};});
 if(r.content.kind==='text')return{scope:r.content.scope,kind:'text',text:r.content.text!,source:r.identities[0]};
 const sources=await Promise.all(r.content.sources.map(async(ref,index)=>{const loaded=ref.kind==='upload'?await new AiAssets(identity,directory).download(token,ref.assetId):await new FileService(identity,directory).download(token,ref.fileVersionId,r.content.submission!.taskId,'original');return{...r.identities[index],filename:ref.kind==='upload'?(loaded.metadata as ReturnType<typeof assetDTO>).filename:(loaded.metadata as {name:string}).name,mime:loaded.metadata.mime,bytes:loaded.bytes};}));
 await identity.repo.transaction(s=>resolveVersion(s,identity.principal(s,token),inputId,versionId,identity.clock));
 return r.content.kind==='pdf'?{scope:r.content.scope,kind:'pdf',source:sources[0],selectedPages:r.content.selectedPages}:{scope:r.content.scope,kind:'images',sources};
}
/** Filter every source by current authority before counts/options; no price data is loaded into DTOs. */
export function sourcePicker(s:UnitOfWork,p:Principal,contextId:string,clock:Clock){
 contextAccess(s,p,contextId,clock);
 const visible=<T>(read:()=>T):T[]=>{try{return[read()];}catch(e){if(e instanceof AuthError&&[403,404,409].includes(e.status))return[];throw e;}};
 const submissions=s.list('submission',contextId).flatMap(sub=>visible(()=>{storedId(sub.data.taskId);storedId(sub.data.requestId);const{task}=submissionTask(s,p,sub.data.taskId,clock);const request=s.get('requestVersion',sub.data.requestId);if(!request)fail('STORAGE_UNAVAILABLE',503,'요청 버전을 확인할 수 없습니다.');return{id:sub.id,sequence:storedCount(sub.data.sequence),taskId:task.id,taskTitle:storedText(task.data.title),requestId:request.id,requestSequence:storedCount(request.data.sequence),submittedAt:storedText(sub.data.submittedAt),products:sub.data.productUseIds.flatMap(useId=>visible(()=>{const use=readProductUse(s,p,useId,clock);return{id:use.id,productId:use.productId,productVersionId:use.productVersionId,contextProductVersionId:use.contextProductVersionId,name:use.common.name};})),files:sub.data.fileVersionIds.flatMap(fid=>visible(()=>{const file=s.get('fileVersion',fid);if(!file)fail('NOT_FOUND',404,'자료를 찾을 수 없습니다.');canReferenceFile(s,p,file,taskScope(task),clock);return{id:file.id,name:storedText(file.data.originalName),mime:storedText(file.data.mime),bytes:storedCount(file.data.bytes),sha256:storedHash(file.data.sha256)};}))};}));
 const products=s.list('contextProduct',contextId).flatMap(cp=>visible(()=>{const r=resolveProduct(s,p,contextId,cp.data.productId,clock);return{productId:r.product.id,name:storedText(r.common.data.common.name),currentProductVersionId:r.common.id,currentContextProductVersionId:r.local.id,commonVersions:s.list('productVersion').filter(v=>v.data.productId===r.product.id).map(v=>({id:v.id,sequence:storedCount(v.data.sequence),name:storedText(v.data.common.name)})),contextVersions:s.list('contextProductVersion',contextId).filter(v=>v.data.contextProductId===cp.id).map(v=>({id:v.id,sequence:storedCount(v.data.sequence)}))};}));
 const uploads=s.list('aiAsset',contextId).flatMap(a=>visible(()=>assetDTO(assetAccess(s,p,a.id,contextId,clock))));
 return{contextId,submissions,products,uploads,capabilities:{create:true,upload:true,createInternal:p.user.data.role==='gsg'},limits:{textCodePoints:10000,fileBytes:10485760,images:4,selectedPages:10},analysis:{connected:false as const,status:'NOT_CONNECTED' as const}};
}
