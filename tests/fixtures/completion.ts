import { randomUUID } from 'node:crypto';
import type { IdentityService } from '@/server/auth/service';
import { TaskService } from '@/server/tasks/service';
import { ProductService } from '@/server/products/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { InquiryService } from '@/server/inquiries/service';
import { CorrectionService } from '@/server/corrections/service';
import { blankContent,blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import type { ReviewTarget } from '@/domain/corrections/types';
import { tokenFor } from './policy';

export const contextId='ctx-jp-a-luna';
export const admin=tokenFor('user-admin'),brand=tokenFor('user-luna'),team=tokenFor('user-team');
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=','base64');
export async function createCompletionTask(identity:IdentityService,title='실제 완료 생산자'){
    const tasks=new TaskService(identity),content=blankContent();content.title=title;content.description='합성 공개 요청';content.deadline.responsibleUserId='user-gsg';
    content.requirements=[{...blankRequirement('answer'),label:'공개 답변'},{...blankRequirement('missing','short_text'),label:'아직 미제출'}];
    const taskId=(await tasks.create(admin,{targets:[{contextId,ownerId:'user-gsg',assigneeId:'user-luna',coAssigneeIds:['user-co'],productIds:['product-serum']}],content,category:'spot',idempotencyKey:randomUUID()})).ids[0];
    await tasks.command(admin,taskId,{command:'publish',expectedRevision:1,idempotencyKey:randomUUID()});return taskId;
}
export async function completionSubmission(identity:IdentityService,directory:string,taskId:string){
    const service=new SubmissionService(identity);let workspace=await service.workspace(brand,taskId);
    const upload=await new SubmissionFiles(identity,directory).upload(brand,taskId,workspace.request.id,[{clientItemId:randomUUID(),name:'원본.png',type:'image/png',bytes:png}]);
    if(upload.items[0].state!=='ready')throw Error('actual fixture upload failed');const fileId=upload.items[0].file.id;
    const product=await new ProductService(identity).detail(brand,'product-serum',contextId);
    await service.draft(brand,taskId,{command:'save',baseRequestId:workspace.request.id,expectedDraftRevision:workspace.draft?.revision??0,content:{...blankDraft(),answers:[{requestId:workspace.request.id,requirementKey:'answer',productId:null,type:'long_text',input:{text:'실제 부분 제출'}}],artifacts:[{fileVersionId:fileId,role:'review_copy',answer:null}],productSelections:[{productId:product.productId,expectedCommonRevision:product.commonRevision,expectedContextRevision:product.contextRevision,bindingIds:[],retailPriceVersionId:null,asOfDate:'2026-09-21'}]},idempotencyKey:randomUUID()});
    workspace=await service.workspace(brand,taskId);const id=(await service.submit(brand,taskId,{baseRequestId:workspace.request.id,expectedDraftRevision:workspace.draft!.revision,expectedTaskRevision:workspace.taskRevision,mode:'partial',idempotencyKey:randomUUID()})).ids[0];
    const row=(await identity.repo.get('submission',id))!;
    return {taskId,submissionId:id,requestId:row.data.requestId,submissionContentHash:row.data.contentHash,answer:null,fileVersionIds:[fileId],productUseIds:row.data.productUseIds,location:{page:'1',locator:'하단'}} satisfies ReviewTarget;
}
export async function completionInquiry(identity:IdentityService,taskId:string,actor=brand,text='외부 회신이 필요한 질문'){
    const service=new InquiryService(identity),draft=await service.createDraft(actor,{contextId,taskId,idempotencyKey:randomUUID()});
    await service.command(actor,draft.conversationId,{command:'publish_first',expectedRevision:draft.revision,title:'실제 문의',content:{clientMessageId:randomUUID(),body:text,fileVersionIds:[]},idempotencyKey:randomUUID()});
    const d=await service.detail(admin,draft.conversationId);if(d.phase!=='active')throw Error('active inquiry required');const q=d.questions[0];
    await service.command(admin,draft.conversationId,{command:'state',questionId:q.id,expectedQuestionRevision:q.revision,state:'external_waiting',reason:'외부 확인 요청',externalWait:{counterparty:'합성 기관',sentAt:'2026-09-21T15:30:00+09:00',responsibleUserId:'user-gsg',nextCheckDate:'2026-10-05',timezone:'Asia/Tokyo',latestResult:'실제 외부 회신 대기'},idempotencyKey:randomUUID()});
    return {conversationId:d.id,questionId:q.id};
}
export async function completionCorrection(identity:IdentityService,target:ReviewTarget){
    const service=new CorrectionService(identity),taskId=target.taskId;
    const opinion=(await service.command(admin,{command:'save_opinion',taskId,opinionId:null,expectedRevision:0,opinion:{target,source:{kind:'external_opinion',agency:'합성 기관',reviewer:'외부 검토자',source:'합성 원문'},originalText:'G11_PRIVATE_ORIGINAL',internalFileVersionIds:[],receivedOn:'2026-09-21',conflictingOpinionVersionIds:[]},idempotencyKey:randomUUID()})).ids[1];
    const draftId=(await service.command(admin,{command:'save_draft',taskId,draftId:null,expectedRevision:0,draft:{title:'실제 공개 수정',summary:'미해결 수정',items:[{key:'change',target,internalOpinionVersionIds:[opinion],publicSource:'허용 공개 원문',change:'표현 수정',reason:'규격 확인',publicDescription:'G11_PUBLIC_CORRECTION',priority:'normal',issue:'correction'}],mode:'urgent_partial',pendingScopes:[{agency:'추가 기관',scope:'원문 추가 의견',expectedOn:null}],previousBatchVersionId:null},idempotencyKey:randomUUID()})).ids[0];
    return (await service.command(admin,{command:'publish',taskId,draftId,expectedRevision:1,idempotencyKey:randomUUID()})).ids[0];
}
