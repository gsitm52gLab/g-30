import { StoreError, type RecordKind, type RecordInput, type SyncUnitOfWork as UnitOfWork } from '../records';
const immutable: RecordKind[]=['aiAsset','aiVersion','aiSnapshot'];
export function aiRelations<K extends RecordKind>(s:UnitOfWork,kind:K,input:RecordInput<K>){
 if(!['aiInput','aiRun',...immutable].includes(kind))return;
 const bad=()=>{throw new StoreError('INVALID_RECORD');};const d=input.data as unknown as Record<string,unknown>;
 if(!input.contextId||!s.get('context',input.contextId))bad();
 if(immutable.includes(kind)&&s.get(kind,input.id))bad();
 if(kind==='aiInput'||kind==='aiAsset'){if(!s.get('user',String(d.createdBy))||!['context','staff'].includes(String(d.visibility)))bad();return;}
 if(s.get('aiInput',String(d.inputId))?.contextId!==input.contextId)bad();
 if(kind==='aiVersion'){if(!s.get('user',String(d.createdBy))||!Number.isSafeInteger(d.sequence)||Number(d.sequence)<1)bad();if(s.list('aiVersion',input.contextId!).some(r=>r.data.inputId===d.inputId&&r.data.sequence===d.sequence))throw new StoreError('CONFLICT');if(d.previousId!==null&&s.get('aiVersion',String(d.previousId))?.data.inputId!==d.inputId)bad();}
 if(kind==='aiRun'||kind==='aiSnapshot'){if(s.get('aiVersion',String(d.versionId))?.data.inputId!==d.inputId)bad();}
 if(kind==='aiRun'){if(!['queued','reading','finished','unread','rejected','out_of_scope','failed'].includes(String(d.state)))bad();if(s.list('aiRun',input.contextId!).some(r=>r.id!==input.id&&r.data.versionId===d.versionId&&r.data.attempt===d.attempt))throw new StoreError('CONFLICT');}
 if(kind==='aiSnapshot'&&s.get('aiRun',String(d.runId))?.data.versionId!==d.versionId)bad();
}
