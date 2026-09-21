import type { Clock,UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { correctionTask,canManage } from './access';
import { batchContent,itemState,reviewDTO } from './projection';
import { exactTarget } from './targets';
/** Synchronous caller UoW. This module never imports submissions/read or recaptures products. */
export function readCorrectionRemainder(s:UnitOfWork,p:Principal,taskId:string,clock:Clock,submissionId:string|null=null){
    const task=correctionTask(s,p,taskId,clock),batches=s.list('correctionBatch',task.contextId!).filter(b=>b.data.taskId===taskId).sort((a,b)=>a.data.sequence-b.data.sequence);
    const items=batches.flatMap(b=>batchContent(b).items.filter(i=>!submissionId||i.target.submissionId===submissionId).map(i=>{exactTarget(s,p,i.target,clock);const state=itemState(s,p,b,i.key,clock);return {batchVersionId:b.id,itemKey:i.key,targetSubmissionId:i.target.submissionId,status:state.status,reflectionId:state.reflectionId,resolutionId:state.resolutionId};}));
    return {connected:true as const,batchVersionIds:batches.filter(b=>items.some(i=>i.batchVersionId===b.id)).map(b=>b.id),items,unresolved:items.filter(i=>i.status!=='resolved').length};
}
export function readSubmissionReview(s:UnitOfWork,p:Principal,taskId:string,submissionId:string,clock:Clock){
    const task=correctionTask(s,p,taskId,clock),remainder=readCorrectionRemainder(s,p,taskId,clock,submissionId);
    // Private review existence/results must not affect brand counts, status or time.
    const reviews=canManage(s,p,task,clock)?s.list('correctionReview',task.contextId!).filter(r=>r.data.taskId===taskId&&r.data.target.submissionId===submissionId).map(r=>reviewDTO(s,p,r,clock)):[];
    return {...remainder,status:remainder.unresolved?'changes_requested' as const:reviews.length?'recorded' as const:'pending' as const,reviews};
}
