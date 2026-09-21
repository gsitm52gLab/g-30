import { StoreError, type UnitOfWork, type RecordKind, type RecordInput } from '../records';
import { attemptData, outcomeData, planData, settingData } from './parse';
export function providerRelations<K extends RecordKind>(s:UnitOfWork,kind:K,input:RecordInput<K>) {
 if(kind==='aiAnalysisRun'){const old=s.get('aiAnalysisRun',input.id);if(old?.data.engine==='provider'){const next=input.data as unknown as Record<string,unknown>;for(const key of ['inputId','inputVersionId','extractionRunId','extractionSnapshotId','snapshotHash','corpusReleaseId','corpusManifestHash','engine','modelId','promptVersion','taskId','createdBy','attempt','previousRunId'] as const)if(old.data[key]!==next[key])throw new StoreError('INVALID_RECORD');if(old.data.providerCalled&&!next.providerCalled)throw new StoreError('INVALID_RECORD');}return;}
 if(!['aiProviderSetting','aiProviderPlan','aiProviderAttempt','aiProviderOutcome'].includes(kind))return;
 const bad=():never=>{throw new StoreError('INVALID_RECORD');};
 if(!input.contextId||!s.get('context',input.contextId))bad();
 try {
  if(kind==='aiProviderSetting'){const d=settingData(input.data);if(!s.get('user',d.changedBy))bad();if(s.list(kind,input.contextId!).some(r=>r.id!==input.id))throw new StoreError('CONFLICT');return;}
  if(kind==='aiProviderPlan'){const d=planData(input.data),r=s.get('aiAnalysisRun',d.runId);if(s.get(kind,input.id)||input.id!==d.runId||r?.contextId!==input.contextId||r.data.engine!=='provider'||r.data.modelId!==d.model||r.data.promptVersion!==d.promptVersion)bad();return;}
  if(kind==='aiProviderAttempt'){
   const d=attemptData(input.data),r=s.get('aiAnalysisRun',d.runId),p=s.get('aiProviderPlan',d.runId);if(r?.contextId!==input.contextId||!p||!s.get('user',d.actorId)||d.sequence>3)bad();
   if(s.list('aiProviderAttempt',input.contextId!).some(a=>a.id!==input.id&&a.data.runId===d.runId&&a.data.sequence===d.sequence))throw new StoreError('CONFLICT');
   const old=s.get('aiProviderAttempt',input.id);if(old){const before=attemptData(old.data);for(const key of ['runId','sequence','actorId','claimId','intentAt','leaseUntil'] as const)if(before[key]!==d[key])bad();if(['intent','dispatched','settled'].indexOf(d.phase)<['intent','dispatched','settled'].indexOf(before.phase))bad();if(before.phase==='settled')bad();if(before.requestHash!==null&&(d.requestHash!==before.requestHash||d.inputBytes!==before.inputBytes||d.approximateInputTokens!==before.approximateInputTokens))bad();if(before.dispatchedAt!==null&&d.dispatchedAt!==before.dispatchedAt)bad();}
   if(d.outcomeId!==null&&(d.phase!=='settled'||s.get('aiProviderOutcome',d.outcomeId)?.data.attemptId!==input.id))bad();return;
  }
  const raw=input.data as unknown as Record<string,unknown>,p=typeof raw.runId==='string'?s.get('aiProviderPlan',raw.runId):null;if(!p)bad();const d=outcomeData(raw,planData(p!.data).model),a=s.get('aiProviderAttempt',d.attemptId);if(s.get(kind,input.id)||a?.contextId!==input.contextId||a.data.runId!==d.runId)bad();if(s.list('aiProviderOutcome').some(o=>o.data.attemptId===d.attemptId))throw new StoreError('CONFLICT');
 }catch(e){if(e instanceof StoreError)throw e;bad();}
}
