import type { Clock,UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { ReviewTarget } from '@/domain/corrections/types';
import { fail,unavailable } from '@/server/auth/errors';
import { taskScope } from '@/server/policy/projection';
import { canReferenceFile } from '@/server/files/access';
import { fileMetadata,fileUrls,sourceReference } from '@/server/files/service';
import { readProductUse } from '@/server/products/capture';
import { contentFiles } from '@/domain/submissions/files';
import { correctionTask } from './access';
import * as safe from './stored';
export function exactTarget(s:UnitOfWork,p:Principal,input:ReviewTarget,clock:Clock){
    const target=safe.target(input),task=correctionTask(s,p,target.taskId,clock),row=s.get('submission',target.submissionId),request=s.get('requestVersion',target.requestId);
    if(!row||row.contextId!==task.contextId||row.data.taskId!==task.id||row.data.requestId!==target.requestId||row.data.contentHash!==target.submissionContentHash||request?.data.taskId!==task.id)unavailable();
    const a=target.answer,rowAnswer=a?row.data.answers.find(x=>x.requestId===target.requestId&&x.requirementKey===a.requirementKey&&x.productId===a.productId):null;
    if(a&&!rowAnswer)unavailable();
    const products=target.productUseIds.map(id=>{const use=s.get('productUseSnapshot',id);if(!use||!row.data.productUseIds.includes(id)||use.data.ownerType!=='submission'||use.data.ownerId!==row.id||use.data.taskId!==task.id||use.data.requestId!==target.requestId||a?.productId&&use.data.productId!==a.productId)unavailable();return readProductUse(s,p,id,clock);});
    const answerFiles=rowAnswer?contentFiles({answers:[rowAnswer],artifacts:row.data.artifacts.filter(x=>x.answer?.requirementKey===a!.requirementKey&&x.answer.productId===a!.productId),links:[],narrative:'',productSelections:[]}):row.data.fileVersionIds;
    const files=target.fileVersionIds.map(id=>{const f=s.get('fileVersion',id),inAnswer=answerFiles.includes(id)&&row.data.fileVersionIds.includes(id),inUse=products.some(u=>u.files.some(f=>f.fileVersionId===id));if(!f||f.data.visibility!=='public'||!inAnswer&&!inUse)unavailable();canReferenceFile(s,p,f,taskScope(task),clock);return {...fileMetadata(f),...fileUrls(f,sourceReference(f))};});
    return {target,task,row,products,files};
}
export function internalFiles(s:UnitOfWork,p:Principal,taskId:string,ids:string[],clock:Clock){
    const task=correctionTask(s,p,taskId,clock,'manage');return ids.map(id=>{const f=s.get('fileVersion',id);if(!f||f.data.taskId!==taskId||f.data.visibility!=='internal'||f.data.owner&&f.data.owner.kind!=='task')unavailable();canReferenceFile(s,p,f,taskScope(task),clock);return {...fileMetadata(f),...fileUrls(f,taskId)};});
}
export function laterTarget(s:UnitOfWork,p:Principal,original:ReviewTarget,next:ReviewTarget,clock:Clock){
    const old=exactTarget(s,p,original,clock),now=exactTarget(s,p,next,clock);
    if(now.row.data.sequence<=old.row.data.sequence||original.answer&&JSON.stringify(original.answer)!==JSON.stringify(next.answer)||original.fileVersionIds.length&&!next.fileVersionIds.length||old.products.some(u=>!now.products.some(n=>n.productId===u.productId)))fail('TARGET_MISMATCH',422,'같은 항목과 상품 범위의 후속 제출 및 반영 파일을 선택해 주세요.');
    return now;
}
