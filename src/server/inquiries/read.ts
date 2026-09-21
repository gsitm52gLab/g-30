import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { ActiveConversationDetailDTO, ConversationDetailDTO, ConversationSummaryDTO, InternalMessageDTO, PublicMessageDTO, QuestionCounts } from '@/domain/inquiries/types';
import type { InquiryListQuery } from '@/domain/inquiries/commands';
import { authorize, decide } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { inquiryScope, staff, label, visibleTask } from './access';
import { cursor } from './events';
import { summary, questionDTO, questions, messageDTO, readDTO, history, fileDTO, messages as messageRows } from './projection';
import * as safe from './stored';
export interface InquiryList {items:ConversationSummaryDTO[];total:number;counts:QuestionCounts;capabilities:{create:boolean}}
/** Sync composable helper for the real home/task UI. No nested transaction or network. */
export function readInquirySummary(s:UnitOfWork,p:Principal,contextId:string,clock:Clock,taskId:string|null=null) {
    authorize(s,p,'context.read',contextResource(contextId),clock);
    const items=s.list('conversation',contextId).filter(c=>c.data.phase==='active'&&(p.user.data.role==='gsg'||c.data.initiatorId===p.user.id)&&(!taskId||c.data.taskId===taskId)).filter(c=>decide(s,p,'inquiry.read',inquiryScope(c),clock).allowed).map(c=>summary(s,p,c,clock)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    const counts:QuestionCounts={questions:0,answered:0,unresolved:0,waitingGsg:0,waitingBrand:0,externalWaiting:0};for(const item of items)for(const k of Object.keys(counts) as (keyof QuestionCounts)[])counts[k]+=item.counts[k];
    return {items,counts};
}
export function listDTO(s:UnitOfWork,p:Principal,q:InquiryListQuery,clock:Clock):InquiryList {
    const data=readInquirySummary(s,p,q.contextId,clock,q.taskId),filtered=data.items.filter(i=>q.state==='all'||i.counts.unresolved>0);
    return {items:filtered.slice(q.offset,q.offset+q.limit),total:filtered.length,counts:data.counts,capabilities:{create:p.user.data.role==='brand'}};
}
export function detailDTO(s:UnitOfWork,p:Principal,c:StoredRecord<'conversation'>,clock:Clock):ConversationDetailDTO {
    const ownFiles=s.list('fileVersion',c.contextId!).filter(f=>f.data.owner?.kind==='inquiry'&&f.data.owner.conversationId===c.id&&f.data.uploaderId===p.user.id).map(f=>fileDTO(s,p,f,c,clock));
    if(c.data.phase==='draft')return {phase:'draft',id:c.id,contextId:c.contextId!,revision:safe.count(c.revision,1),taskId:visibleTask(s,p,c.data.taskId,c.contextId!,clock)?.id??null,files:ownFiles,capabilities:{upload:true,publishFirst:true}};
    const isStaff=p.user.data.role==='gsg',messages=messageRows(s,c).map(m=>messageDTO(s,p,m,c,clock) as PublicMessageDTO);
    const result:ActiveConversationDetailDTO={...summary(s,p,c,clock),questions:questions(s,c).map(q=>questionDTO(s,p,q,c)),messages,reads:s.list('inquiryRead',c.contextId!).filter(r=>r.data.conversationId===c.id).map(r=>readDTO(s,p,r,c)),history:history(s,p,c,clock),capabilities:{send:true,ask:!isStaff,answer:isStaff,supplement:!isStaff,manageState:isStaff,linkTask:isStaff,upload:true,uploadInternal:isStaff,internalNote:isStaff},cursor:cursor(s,p,c),readyFiles:ownFiles,staffOptions:isStaff?staff(s,c.contextId!).map(u=>({id:u.id,label:label(s,p,u.id,c.contextId!)})):[]};
    return isStaff?{...result,internalMessages:messageRows(s,c,true).map(m=>messageDTO(s,p,m,c,clock) as InternalMessageDTO)}:result;
}
