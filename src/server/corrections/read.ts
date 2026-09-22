import type { Clock,UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { taskScope } from '@/server/policy/projection';
import { decide } from '@/server/policy/policy';
import { fileMetadata,fileUrls } from '@/server/files/service';
import { visibleFile } from '@/server/files/access';
import { snapshotDTO } from '@/server/submissions/read';
import { correctionTask,canManage } from './access';
import { readCorrectionRemainder } from './summary';
import { batchDTO,opinionDTO,reviewDTO } from './projection';
import * as safe from './stored';
export function correctionWorkspace(s:UnitOfWork,p:Principal,taskId:string,clock:Clock){
    const task=correctionTask(s,p,taskId,clock),manage=canManage(s,p,task,clock),reflect=p.user.data.role==='brand'&&decide(s,p,'submission.write',taskScope(task),clock).allowed;
    const batches=s.list('correctionBatch',task.contextId!).filter(b=>b.data.taskId===taskId).sort((a,b)=>b.data.sequence-a.data.sequence).map(b=>batchDTO(s,p,b,clock));
    const submissions=s.list('submission',task.contextId!).filter(v=>v.data.taskId===taskId).sort((a,b)=>b.data.sequence-a.data.sequence).map(v=>{const d=snapshotDTO(s,p,v,clock);return {id:d.id,sequence:d.sequence,requestId:d.requestId,contentHash:d.contentHash,submittedAt:d.submittedAt,answers:d.answers.map(a=>({requirementKey:a.requirementKey,productId:a.productId,type:a.type,label:d.request.content.requirements.find(q=>q.key===a.requirementKey)?.label??'이전 항목'})),files:d.files,products:d.products};});
    const basic={taskId,contextId:task.contextId!,title:safe.text(task.data.title,200),actorId:p.user.id,capabilities:{manage,reflect,aiCandidate:false as const},batches,submissions,remainder:readCorrectionRemainder(s,p,taskId,clock)};
    if(!manage)return {...basic,staff:null};
    return {...basic,staff:{opinions:s.list('correctionOpinion',task.contextId!).filter(r=>r.data.taskId===taskId).map(r=>({id:r.id,revision:safe.integer(r.revision,1),currentVersionId:r.data.currentVersionId===null?null:safe.id(r.data.currentVersionId),versions:s.list('correctionOpinionVersion',task.contextId!).filter(v=>v.data.opinionId===r.id).sort((a,b)=>b.data.sequence-a.data.sequence).map(v=>opinionDTO(s,p,v,clock))})),drafts:s.list('correctionDraft',task.contextId!).filter(r=>r.data.taskId===taskId).map(r=>({id:r.id,revision:safe.integer(r.revision,1),publishedVersionId:r.data.publishedVersionId===null?null:safe.id(r.data.publishedVersionId),draft:safe.draft(r.data.draft)})),reviews:s.list('correctionReview',task.contextId!).filter(r=>r.data.taskId===taskId).map(r=>reviewDTO(s,p,r,clock)),internalFiles:s.list('fileVersion',task.contextId!).filter(f=>f.data.taskId===taskId&&f.data.visibility==='internal'&&visibleFile(s,p,f,taskScope(task),clock)).map(f=>({...fileMetadata(f),...fileUrls(f,taskId)}))}};
}
