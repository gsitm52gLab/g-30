import { createHash,randomUUID } from 'node:crypto';
import type { RecordRepository,RecordKind } from '@/domain/records';
/** Test-only observer/explicit malformed fixture; never exposed by an application route. */
export interface CampaignFixtureInput{campaignId:string;action?:'extension'|'corrupt'}
export async function campaignFixture(repo:RecordRepository,input:CampaignFixtureInput){return repo.transaction(s=>{
 const row=s.get('campaign',input.campaignId);if(!row)throw Error('synthetic campaign missing');
 if(input.action){const old=s.get('campaignVersion',row.data.currentVersionId!)!,data=structuredClone(old.data);if(input.action==='extension'){(data.menus[0].conditions as unknown as Record<string,unknown>).privateExtra='G12_STORED_CANARY';(data.menus[0].products[0] as unknown as Record<string,unknown>).privateExtra='G12_PRODUCT_CANARY';}else (data.menus[0].conditions.cost as unknown as Record<string,unknown>).amount={secret:'G12_KNOWN_CORRUPTION'};const v=s.create('campaignVersion',{id:randomUUID(),contextId:row.contextId,data:{...data,sequence:row.data.sequence+1,previousId:old.id}});s.update('campaign',row.id,row.revision,{...row.data,currentVersionId:v.id,sequence:row.data.sequence+1,publicRevision:row.data.publicRevision+1});}
 const own:RecordKind[]=['campaignCatalog','campaignCatalogVersion','campaign','campaignVersion','campaignSelection','campaignExternalFact','campaignPhysicalFact','campaignFollowupFact','domainEvent','commandReceipt','audit'];
 const rows=own.map(kind=>({kind,rows:s.list(kind,row.contextId!).filter(r=>r.kind==='campaignCatalog'||r.kind==='campaignCatalogVersion'||r.id===row.id||'campaignId' in r.data&&r.data.campaignId===row.id||'targetId' in r.data&&r.data.targetId===row.id||'command' in r.data&&typeof r.data.command==='string'&&r.data.command.startsWith('campaign.'))}));
 const business=(['task','requestVersion','submission','submissionDraft','productUseSnapshot','fileVersion'] as const).map(kind=>({kind,rows:s.list(kind,row.contextId!)}));const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');return {rows,rowsSha256:sha(rows),business,businessSha256:sha(business)};
});}
export type CampaignFixtureSnapshot=Awaited<ReturnType<typeof campaignFixture>>;
