import { createHash } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
export interface InquiryFixtureInput {conversationId:string;action?:'extend'|'malform'}
/** Private test IPC/repository fixture; never registered as a product route. */
export async function inquiryFixture(repo:RecordRepository,input:InquiryFixtureInput){return repo.transaction(s=>{
    const c=s.get('conversation',input.conversationId);if(!c)throw Error('owned conversation missing');
    if(input.action==='extend')s.update('conversation',c.id,c.revision,{...c.data,unknownExtension:{private:'G09_STORED_EXTENSION'}} as unknown as typeof c.data);
    if(input.action==='malform')s.update('conversation',c.id,c.revision,{...c.data,title:{private:'G09_MALFORMED_TITLE'}} as unknown as typeof c.data);
    const ownKinds:RecordKind[]=['conversation','inquiryQuestion','inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent'];
    const rows=ownKinds.map(kind=>({kind,rows:s.list(kind,c.contextId!).filter(r=>r.id===c.id||'conversationId'in r.data&&r.data.conversationId===c.id)}));
    const unchangedKinds:RecordKind[]=['task','requestVersion','submission','submissionDraft','productUseSnapshot','notice','noticeVersion','noticeRead'];
    const unrelated=unchangedKinds.map(kind=>({kind,rows:s.list(kind)}));
    const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
    return {rows,rowsSha256:sha(rows),unrelatedSha256:sha(unrelated),messages:s.list('inquiryMessage',c.contextId!).filter(m=>m.data.conversationId===c.id),fileRows:s.list('fileVersion',c.contextId!).filter(f=>f.data.owner?.kind==='inquiry'&&f.data.owner.conversationId===c.id)};
});}
export type InquiryFixtureSnapshot=Awaited<ReturnType<typeof inquiryFixture>>;
