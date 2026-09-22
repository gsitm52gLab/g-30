import { StoreError,type RecordKind,type RecordInput,type SyncUnitOfWork as UnitOfWork } from '../records';
export function campaignRelations<K extends RecordKind>(s:UnitOfWork,kind:K,input:RecordInput<K>){
 if(!kind.startsWith('campaign'))return;
 const d=input.data as unknown as Record<string,unknown>;
 const invalid=()=>{throw new StoreError('INVALID_RECORD');};
 if(!input.contextId||!s.get('context',input.contextId))invalid();
 if(!['campaign','campaignCatalog'].includes(kind)&&s.get(kind,input.id))invalid();
 if(kind==='campaign') {const t=s.get('task',String(d.taskId));if(!t||t.contextId!==input.contextId)invalid();}
 if(kind==='campaignCatalogVersion') {const r=s.get('campaignCatalog',String(d.catalogId));if(!r||r.contextId!==input.contextId)invalid();}
 if(!['campaignCatalog','campaignCatalogVersion','campaign'].includes(kind)) {
  const r=s.get('campaign',String(d.campaignId));if(!r||r.contextId!==input.contextId)invalid();
  if(kind!=='campaignVersion'){const v=s.get('campaignVersion',String(d.campaignVersionId));if(!v||v.contextId!==input.contextId||v.data.campaignId!==r!.id)invalid();}
 }
 if(!['campaign','campaignCatalog'].includes(kind)){
  const field=kind==='campaignCatalogVersion'?'catalogId':'campaignId';
  if(s.list(kind,input.contextId!).some(r=>r.id!==input.id&&(r.data as unknown as Record<string,unknown>)[field]===d[field]&&(r.data as unknown as Record<string,unknown>).sequence===d.sequence))throw new StoreError('CONFLICT');
 }
}
