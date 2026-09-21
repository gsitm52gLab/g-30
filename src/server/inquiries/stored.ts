import { fail } from '@/server/auth/errors';
import type { ConversationData, ExternalWait, QuestionData, MessageData, QuestionState } from '@/domain/inquiries/types';
export function corrupt(): never { return fail('STORAGE_UNAVAILABLE',503,'문의 기록을 확인할 수 없습니다. 입력을 유지하고 다시 확인해 주세요.'); }
export function object(v: unknown): Record<string,unknown> { if(!v || typeof v!=='object' || Array.isArray(v))corrupt(); return v as Record<string,unknown>; }
export function text(v: unknown,max=20000): string { if(typeof v!=='string'||v.length>max)corrupt();return v; }
export function id(v: unknown): string { const r=text(v,160);if(!/^[A-Za-z0-9_-]+$/.test(r))corrupt();return r; }
export function nullableId(v: unknown): string|null {return v===null?null:id(v);}
export function count(v: unknown,min=0): number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)corrupt();return v;}
export function timestamp(v: unknown): string {const r=text(v,60);if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(r)||!Number.isFinite(Date.parse(r))||!Number.isFinite(Date.parse(r.slice(0,10)))||new Date(r.slice(0,10)).toISOString().slice(0,10)!==r.slice(0,10))corrupt();return r;}
export function nullableTime(v: unknown): string|null {return v===null?null:timestamp(v);}
export function ids(v: unknown,max=10): string[] {if(!Array.isArray(v)||v.length>max)corrupt();const r=v.map(id);if(new Set(r).size!==r.length)corrupt();return r;}
export function state(v: unknown): QuestionState {if(v!=='gsg_waiting'&&v!=='brand_supplement_waiting'&&v!=='external_waiting'&&v!=='resolved')corrupt();return v;}
export function external(v: unknown): ExternalWait|null {
    if(v===null)return null;const d=object(v),date=text(d.nextCheckDate,10),zone=text(d.timezone,100);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)corrupt();
    try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{corrupt();}
    return {counterparty:text(d.counterparty,500),sentAt:nullableTime(d.sentAt),responsibleUserId:id(d.responsibleUserId),nextCheckDate:date,timezone:zone,latestResult:text(d.latestResult,2000)};
}
export function conversation(v: unknown): ConversationData {
    const d=object(v),common={initiatorId:id(d.initiatorId),taskId:nullableId(d.taskId),createdBy:id(d.createdBy),createdAt:timestamp(d.createdAt),lastResolvedAt:nullableTime(d.lastResolvedAt),lastReopenedAt:nullableTime(d.lastReopenedAt)};
    if(d.phase==='draft') {if(d.title!==''||d.activatedAt!==null||d.publicRevision!==0||d.publicSequence!==0||d.internalSequence!==0||d.publicUpdatedAt!==null)corrupt();return {...common,phase:'draft',title:'',activatedAt:null,publicRevision:0,publicSequence:0,internalSequence:0,publicUpdatedAt:null};}
    if(d.phase!=='active')corrupt();const title=text(d.title,200);if(!title.trim())corrupt();
    return {...common,phase:'active',title,activatedAt:timestamp(d.activatedAt),publicRevision:count(d.publicRevision,1),publicSequence:count(d.publicSequence,1),internalSequence:count(d.internalSequence),publicUpdatedAt:timestamp(d.publicUpdatedAt)};
}
export function question(v: unknown): QuestionData {
    const d=object(v),st=state(d.state),wait=external(d.externalWait);if((st==='external_waiting')!==(wait!==null))corrupt();
    return {conversationId:id(d.conversationId),openingMessageId:id(d.openingMessageId),state:st,externalWait:wait,latestAnswerMessageId:nullableId(d.latestAnswerMessageId),lastResolvedAt:nullableTime(d.lastResolvedAt),createdBy:id(d.createdBy),createdAt:timestamp(d.createdAt),updatedAt:timestamp(d.updatedAt)};
}
export function message(v: unknown): MessageData {
    const d=object(v),base={conversationId:id(d.conversationId),questionId:nullableId(d.questionId),clientMessageId:id(d.clientMessageId),authorId:id(d.authorId),body:text(d.body),fileVersionIds:ids(d.fileVersionIds),createdAt:timestamp(d.createdAt),sequence:count(d.sequence,1)};
    if(!base.body.trim()&&!base.fileVersionIds.length)corrupt();
    if(d.visibility==='internal'&&d.kind==='internal_note')return {...base,visibility:'internal',kind:'internal_note'};
    if(d.visibility!=='public'||typeof d.kind!=='string'||!['question','comment','acknowledgement','answer','supplement'].includes(d.kind))corrupt();
    return {...base,visibility:'public',kind:d.kind as 'question'|'comment'|'acknowledgement'|'answer'|'supplement'};
}
