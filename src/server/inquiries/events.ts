import { randomBytes, createHash } from 'node:crypto';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { InquiryCursorBinding, InquiryEventPage, StaffInquiryEvent, PublicMessageDTO, InternalMessageDTO } from '@/domain/inquiries/types';
import { fail } from '@/server/auth/errors';
import * as safe from './stored';
import { counts, messageDTO, questionDTO, readDTO } from './projection';
import { visibleTask } from './access';
function binding(p:Principal,c:StoredRecord<'conversation'>,publicPosition:number,internalPosition:number):InquiryCursorBinding {
    return {conversationId:c.id,userId:p.user.id,view:p.user.data.role==='gsg'?'staff':'public',publicPosition,internalPosition:p.user.data.role==='gsg'?internalPosition:null};
}
export function cursor(s:UnitOfWork,p:Principal,c:StoredRecord<'conversation'>,publicPosition=c.data.publicSequence,internalPosition=c.data.internalSequence) {
    const b=binding(p,c,publicPosition,internalPosition),old=s.list('inquiryCursor',c.contextId!).find(r=>r.data.conversationId===b.conversationId&&r.data.userId===b.userId&&r.data.view===b.view&&r.data.publicPosition===b.publicPosition&&r.data.internalPosition===b.internalPosition);
    if(old){if(typeof old.data.token!=='string'||!/^[\w-]{43}$/.test(old.data.token))safe.corrupt();return old.data.token;}
    const token=randomBytes(32).toString('base64url');s.create('inquiryCursor',{id:createHash('sha256').update(token).digest('hex'),contextId:c.contextId,data:{...b,token}});return token;
}
/** Called only after current conversation authorization in the caller's UoW. */
export function eventPage(s:UnitOfWork,p:Principal,c:StoredRecord<'conversation'>,clock:Clock,after:string|null,limit:number):InquiryEventPage<StaffInquiryEvent> {
    if(!after){const token=cursor(s,p,c);return {events:[{type:'resync',cursor:token,reason:'cursor_unavailable'}],cursor:token,hasMore:false};}
    const old=s.get('inquiryCursor',createHash('sha256').update(after).digest('hex'));
    const view=p.user.data.role==='gsg'?'staff':'public';
    if(!old||old.data.token!==after||old.contextId!==c.contextId||old.data.userId!==p.user.id||old.data.conversationId!==c.id||old.data.view!==view)fail('CURSOR_UNAVAILABLE',409,'연결 위치를 다시 확인해야 합니다. 문의를 새로 조회해 주세요.');
    let pub=safe.count(old.data.publicPosition),internal=view==='staff'?safe.count(old.data.internalPosition):0;
    if(pub>c.data.publicSequence||internal>c.data.internalSequence||view==='public'&&old.data.internalPosition!==null)safe.corrupt();
    const rows=s.list('inquiryEvent',c.contextId!).filter(r=>r.data.conversationId===c.id).filter(r=>{if(r.data.lane!=='public'&&r.data.lane!=='internal')safe.corrupt();return r.data.lane==='public'||view==='staff';}).map(r=>{
        const d=r.data;safe.id(d.recordId);safe.timestamp(d.at);safe.count(d.position,1);
        if(d.lane==='public'&&!['message','question','read','task_link'].includes(d.kind)||d.lane==='internal'&&d.kind!=='internal_message')safe.corrupt();return r;
    }).filter(r=>r.data.position>(r.data.lane==='public'?pub:internal)).sort((a,b)=>a.data.lane.localeCompare(b.data.lane)||a.data.position-b.data.position);
    // Each lane is ordered independently; an internal event never advances a public cursor.
    const events:StaffInquiryEvent[]=[];
    for(const r of rows.slice(0,limit)) {
        const d=r.data;if(d.lane==='public')pub=d.position;else internal=d.position;
        const token=cursor(s,p,c,pub,internal);
        if(d.kind==='message'||d.kind==='internal_message') {
            const m=s.get('inquiryMessage',d.recordId);if(!m||m.data.visibility!==(d.kind==='message'?'public':'internal'))safe.corrupt();
            const value=messageDTO(s,p,m,c,clock);
            events.push(d.kind==='message'?{type:'message',cursor:token,message:value as PublicMessageDTO}:{type:'internal_message',cursor:token,message:value as InternalMessageDTO});
        } else if(d.kind==='question') {const q=s.get('inquiryQuestion',d.recordId);if(!q)safe.corrupt();events.push({type:'question',cursor:token,question:questionDTO(s,p,q,c),counts:counts(s,c)});}
        else if(d.kind==='read') {const r=s.get('inquiryRead',d.recordId);if(!r)safe.corrupt();events.push({type:'read',cursor:token,read:readDTO(s,p,r,c)});}
        else {const link=s.get('inquiryTaskLink',d.recordId);if(!link||link.data.conversationId!==c.id)safe.corrupt();events.push({type:'task_link',cursor:token,task:visibleTask(s,p,safe.id(link.data.taskId),c.contextId!,clock)});}
    }
    return {events,cursor:events.at(-1)?.cursor??after,hasMore:rows.length>limit};
}
