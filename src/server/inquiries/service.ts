import { randomUUID } from 'node:crypto';
import type { IdentityService, Principal } from '@/server/auth/service';
import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { ConversationData, InquiryCommandResult, InquiryEventData, InquiryEventPage, StaffInquiryEvent, MessageData, QuestionData, QuestionState, ExternalWait } from '@/domain/inquiries/types';
import type { MessageInput } from '@/domain/inquiries/commands';
import { parseCreateConversationDraft, parseInquiryCommand, parseInquiryListQuery, parseInquiryEventsQuery, inquiryId } from '@/domain/inquiries/validate';
import { fail, unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { canReferenceFile } from '@/server/files/access';
import { resolveInquiry, activeInquiry, inquiryScope, taskReference, staff, visibleTask } from './access';
import { listDTO, detailDTO, readInquirySummary } from './read';
import { eventPage } from './events';
import { hash, receipt, receiptKey, replay } from './receipts';
import { counts } from './projection';
import * as safe from './stored';
type ActiveData=Extract<ConversationData,{phase:'active'}>;
function result(ids:string[]):InquiryCommandResult {if(ids.length!==4)safe.corrupt();return {conversationId:safe.id(ids[0]),questionId:ids[1]?safe.id(ids[1]):null,messageId:ids[2]?safe.id(ids[2]):null,taskId:ids[3]?safe.id(ids[3]):null};}
const resultIds=(r:InquiryCommandResult)=>[r.conversationId,r.questionId??'',r.messageId??'',r.taskId??''];
function conflict():never{return fail('CONFLICT',409,'다른 변경이 반영되었습니다. 입력을 유지하고 최신 문의를 확인해 주세요.');}
export class InquiryService {
    constructor(public identity:IdentityService,private fault?:()=>void){}
    async createDraft(token:string|undefined,input:unknown) {
        const body=parseCreateConversationDraft(input);
        return this.identity.repo.transaction(s=>{
            const p=this.identity.principal(s,token);authorize(s,p,'context.read',contextResource(body.contextId),this.identity.clock);
            if(p.user.data.role!=='brand')fail('FORBIDDEN',403,'브랜드 계정에서 새 문의를 시작해 주세요.');
            if(body.taskId)taskReference(s,p,body.taskId,body.contextId,this.identity.clock);
            const key=receiptKey('create',p.user.id,body.contextId,body.idempotencyKey),h=hash(body),old=replay(s,key,h,p.user.id);
            if(old){const {row}=resolveInquiry(s,p,safe.id(old[0]),this.identity.clock);return {conversationId:row.id,phase:'draft' as const,revision:1};}
            const id=randomUUID(),at=this.identity.clock();
            const row=s.create('conversation',{id,contextId:body.contextId,data:{phase:'draft',title:'',initiatorId:p.user.id,createdBy:p.user.id,taskId:body.taskId,createdAt:at,activatedAt:null,publicRevision:0,publicSequence:0,internalSequence:0,publicUpdatedAt:null,lastResolvedAt:null,lastReopenedAt:null}});
            receipt(s,body.contextId,key,h,p.user.id,'inquiry.create',[id]);this.fault?.();return {conversationId:id,phase:'draft' as const,revision:row.revision};
        });
    }
    async list(token:string|undefined,params:URLSearchParams){const q=parseInquiryListQuery(params);return this.identity.repo.transaction(s=>listDTO(s,this.identity.principal(s,token),q,this.identity.clock));}
    async summary(token:string|undefined,contextId:string){inquiryId(contextId);return this.identity.repo.transaction(s=>readInquirySummary(s,this.identity.principal(s,token),contextId,this.identity.clock));}
    async detail(token:string|undefined,id:string){inquiryId(id);return this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),{row}=resolveInquiry(s,p,id,this.identity.clock);return detailDTO(s,p,row,this.identity.clock);});}
    async events(token:string|undefined,id:string,params:URLSearchParams,deliver?:(page:InquiryEventPage<StaffInquiryEvent>)=>void){
        inquiryId(id);const q=parseInquiryEventsQuery(params);
        return this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),{row}=activeInquiry(s,p,id,this.identity.clock),page=eventPage(s,p,row,this.identity.clock,q.after,q.limit);deliver?.(page);return page;});
    }
    private files(s:UnitOfWork,p:Principal,c:StoredRecord<'conversation'>,content:MessageInput,internal:boolean) {
        for(const id of content.fileVersionIds){const f=s.get('fileVersion',id);if(!f||f.data.owner?.kind!=='inquiry'||f.data.owner.conversationId!==c.id||f.contextId!==c.contextId)unavailable();
            if(f.data.visibility!==(internal?'internal':'public'))fail('VALIDATION',422,'메시지 공개 범위와 첨부 범위를 확인해 주세요.');
            canReferenceFile(s,p,f,inquiryScope(c),this.identity.clock);
        }
    }
    async command(token:string|undefined,id:string,input:unknown):Promise<InquiryCommandResult> {
        inquiryId(id);const body=parseInquiryCommand(input);
        return this.identity.repo.transaction(s=>{
            const p=this.identity.principal(s,token),{row}=resolveInquiry(s,p,id,this.identity.clock),isStaff=p.user.data.role==='gsg';
            if(['answer','internal_note','state','link_task'].includes(body.command)&&!isStaff)fail('FORBIDDEN',403,'GSG 담당자만 수행할 수 있습니다.');
            if(['publish_first','question','supplement'].includes(body.command)&&isStaff)fail('FORBIDDEN',403,'브랜드 참여자의 질문·보완 전송 기능입니다.');
            const key=receiptKey('command',p.user.id,id,body.idempotencyKey),h=hash(body),prior=replay(s,key,h,p.user.id);
            const present=(ids:string[])=>{const r=result(ids);return {...r,taskId:visibleTask(s,p,r.taskId,row.contextId!,this.identity.clock)?.id??null};};
            if(prior)return present(prior);
            const semantic:Record<string,unknown>={...body};delete semantic.idempotencyKey;delete semantic.expectedRevision;delete semantic.expectedQuestionRevision;
            const messageKey='content'in body?receiptKey('message',p.user.id,id,body.content.clientMessageId):null;
            if(messageKey){const previous=replay(s,messageKey,hash(semantic),p.user.id);if(previous){receipt(s,row.contextId!,key,h,p.user.id,'inquiry.'+body.command,previous);this.fault?.();return present(previous);}}
            const at=this.identity.clock();let data:ActiveData;
            if(body.command==='publish_first') {
                if(row.data.phase!=='draft'||row.revision!==body.expectedRevision)conflict();
                if(row.data.taskId)taskReference(s,p,row.data.taskId,row.contextId!,this.identity.clock);
                data={...row.data,phase:'active',title:body.title,activatedAt:at,publicUpdatedAt:at,publicRevision:1,publicSequence:0,internalSequence:0};
            } else {if(row.data.phase!=='active')conflict();data={...row.data};}
            if('expectedRevision'in body&&body.command!=='publish_first'&&body.expectedRevision!==data.publicRevision)conflict();
            let question:StoredRecord<'inquiryQuestion'>|null=null;
            if('questionId'in body&&body.questionId!==null){question=s.get('inquiryQuestion',body.questionId);if(!question||question.contextId!==row.contextId||safe.question(question.data).conversationId!==id)unavailable();if('expectedQuestionRevision'in body&&question.revision!==body.expectedQuestionRevision)conflict();}
            const out:InquiryCommandResult={conversationId:id,questionId:question?.id??null,messageId:null,taskId:data.taskId};
            let publicChanged=false;
            const event=(lane:'public'|'internal',kind:InquiryEventData['kind'],recordId:string)=>{
                const position=lane==='public'?++data.publicSequence:++data.internalSequence;
                const d:InquiryEventData=lane==='public'?{conversationId:id,position,kind:kind as 'message'|'question'|'read'|'task_link',recordId,at,lane}:{conversationId:id,position,kind:'internal_message',recordId,at,lane};
                s.create('inquiryEvent',{id:randomUUID(),contextId:row.contextId,data:d});if(lane==='public')publicChanged=true;
            };
            const transition=(q:StoredRecord<'inquiryQuestion'>,from:QuestionState|null,to:QuestionState,sourceMessageId:string|null,reason:string,externalWait:ExternalWait|null)=>{
                s.create('inquiryTransition',{id:randomUUID(),contextId:row.contextId,data:{conversationId:id,questionId:q.id,from,to,sourceMessageId,reason,externalWait,actorId:p.user.id,at}});event('public','question',q.id);
            };
            const append=(content:MessageInput,kind:MessageData['kind'],qid:string|null,messageId=randomUUID())=>{
                const internal=kind==='internal_note';this.files(s,p,row,content,internal);
                const common={conversationId:id,questionId:qid,clientMessageId:content.clientMessageId,authorId:p.user.id,body:content.body,fileVersionIds:content.fileVersionIds.slice(),createdAt:at,sequence:(internal?data.internalSequence:data.publicSequence)+1};
                const m:MessageData=internal?{...common,visibility:'internal',kind:'internal_note'}:{...common,visibility:'public',kind};
                s.create('inquiryMessage',{id:messageId,contextId:row.contextId,data:m});event(internal?'internal':'public',internal?'internal_message':'message',messageId);out.messageId=messageId;return messageId;
            };
            if(body.command==='publish_first'||body.command==='question') {
                const wasResolved=body.command==='question'&&counts(s,row).unresolved===0,qid=randomUUID(),mid=randomUUID();
                const q=s.create('inquiryQuestion',{id:qid,contextId:row.contextId,data:{conversationId:id,openingMessageId:mid,state:'gsg_waiting',externalWait:null,latestAnswerMessageId:null,lastResolvedAt:null,createdBy:p.user.id,createdAt:at,updatedAt:at}});
                append(body.content,'question',qid,mid);transition(q,null,'gsg_waiting',mid,'새 질문',null);out.questionId=qid;if(wasResolved)data.lastReopenedAt=at;
            } else if(body.command==='answer'||body.command==='supplement') {
                if(!question)unavailable();const old=safe.question(question.data),mid=append(body.content,body.command,question.id),to=body.command==='answer'?'resolved':'gsg_waiting';
                const next:QuestionData={...question.data,state:to,externalWait:null,updatedAt:at,latestAnswerMessageId:body.command==='answer'?mid:old.latestAnswerMessageId,lastResolvedAt:body.command==='answer'?at:old.lastResolvedAt};
                const q=s.update('inquiryQuestion',question.id,question.revision,next);transition(q,old.state,to,mid,body.command==='answer'?'질문에 답변함':'브랜드 보완 답변',null);
                if(body.command==='supplement'&&old.state==='resolved')data.lastReopenedAt=at;
            } else if(body.command==='message'||body.command==='internal_note')append(body.content,body.command==='internal_note'?'internal_note':body.kind,question?.id??null);
            else if(body.command==='state') {
                if(!question)unavailable();const old=safe.question(question.data);
                if(body.externalWait&&!staff(s,row.contextId!).some(u=>u.id===body.externalWait!.responsibleUserId))fail('VALIDATION',422,'현재 컨텍스트의 GSG 확인 담당자를 선택해 주세요.');
                const q=s.update('inquiryQuestion',question.id,question.revision,{...question.data,state:body.state,externalWait:body.externalWait,updatedAt:at});transition(q,old.state,body.state,null,body.reason,body.externalWait);if(old.state==='resolved')data.lastReopenedAt=at;
            } else if(body.command==='link_task') {
                taskReference(s,p,body.taskId,row.contextId!,this.identity.clock,true);
                if(data.taskId!==body.taskId){const link=s.create('inquiryTaskLink',{id:randomUUID(),contextId:row.contextId,data:{conversationId:id,previousTaskId:data.taskId,taskId:body.taskId,actorId:p.user.id,at}});data.taskId=body.taskId;event('public','task_link',link.id);}out.taskId=body.taskId;
            } else if(body.command==='read') {
                const m=s.get('inquiryMessage',body.throughMessageId);if(!m||safe.message(m.data).conversationId!==id||m.data.visibility!=='public')unavailable();
                if(!s.list('inquiryRead',row.contextId!).some(r=>r.data.conversationId===id&&r.data.userId===p.user.id&&r.data.throughMessageId===m.id)) {
                    const read=s.create('inquiryRead',{id:randomUUID(),contextId:row.contextId,data:{conversationId:id,userId:p.user.id,throughMessageId:m.id,at}});event('public','read',read.id);
                }
            }
            if(publicChanged){if(body.command!=='publish_first')data.publicRevision++;data.publicUpdatedAt=at;if(counts(s,row).questions>0&&counts(s,row).unresolved===0&&['answer'].includes(body.command))data.lastResolvedAt=at;}
            if(publicChanged||body.command==='internal_note')s.update('conversation',id,row.revision,data);
            const ids=resultIds(out);receipt(s,row.contextId!,key,h,p.user.id,'inquiry.'+body.command,ids);if(messageKey)receipt(s,row.contextId!,messageKey,hash(semantic),p.user.id,'inquiry.message',ids);
            s.create('audit',{id:randomUUID(),contextId:row.contextId,data:{actorId:p.user.id,action:'inquiry.'+body.command,targetId:id,before:{},after:{messageId:out.messageId,questionId:out.questionId,taskId:out.taskId},at}});
            if(publicChanged&&body.command!=='read')s.create('domainEvent',{id:randomUUID(),contextId:row.contextId,data:{eventType:'INQUIRY_'+body.command.toUpperCase(),targetId:id,sourceVersionId:out.messageId??out.questionId,actorId:p.user.id,at}});
            this.fault?.();return present(ids);
        });
    }
}
