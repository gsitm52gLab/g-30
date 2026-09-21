import type { UnitOfWork } from '@/domain/records';
import type { IdentityService } from '@/server/auth/service';
import { obj,id,str } from '@/domain/ai-input/validate';
import { PROVIDER_LIMITS,PROMPT_VERSION,type ProviderIssue } from '@/domain/ai-provider/types';
import { attemptData,planData,outcomeData } from '@/domain/ai-provider/parse';
import { PRICING_VERSION,estimateCost } from '@/domain/ai-provider/usage';
import { matchesSchema } from '@/domain/ai-provider/schema';
import { contentHash,sha256 } from '@/domain/ai-review/validate';
import { validateAnalysisResult } from '@/domain/ai-review/results';
import { AuthError,fail,unavailable } from '@/server/auth/errors';
import { audit,fresh,newId,receipt } from '@/server/products/store';
import { fileDirectory } from '@/server/ai-input/assets';
import { AiInputService } from '@/server/ai-input/service';
import { extractionSource,resolveAnalysis,reviewAccess } from '@/server/ai-review/access';
import { loadCorpus } from '@/server/ai-review/corpus';
import { runData } from '@/server/ai-review/stored';
import { analysisDetail,runSummary } from '@/server/ai-review/read';
import { providerConfig,type ProviderConfig } from './config';
import { providerSetting,settingsView } from './projection';
import { ProviderFailure,providerFail,transient,configurationIssue } from './errors';
import { emptyTransport,openaiTransport,providerRequest,type Transport,type TransportResult } from './transport';
type Hooks={config?:()=>ProviderConfig;transport?:Transport;afterPrepare?:()=>Promise<void>;afterResponse?:()=>Promise<void>;fault?:(stage:string)=>void};
type Claim={runId:string;attemptId:string|null;claimId:string|null};
export class AiProviderService {
 constructor(readonly identity:IdentityService,readonly directory=fileDirectory(),private hooks:Hooks={}){}
 get clock(){return this.identity.clock;}
 private config(){return (this.hooks.config??providerConfig)();}
 async settings(token:string|undefined,contextId:string){return this.identity.repo.transaction(s=>{reviewAccess(s,this.identity.principal(s,token),id(contextId),this.clock,true);return settingsView(s,contextId);});}
 async changeSettings(token:string|undefined,contextId:string,raw:Record<string,unknown>){const input=obj(raw,['enabled','expectedRevision','idempotencyKey']);str(input.idempotencyKey);if(typeof input.enabled!=='boolean')fail('VALIDATION',422,'활성 여부를 확인해 주세요.');return this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token);reviewAccess(s,p,id(contextId),this.clock,true);const saved=receipt(s,p,contextId,'ai.provider.settings',input,()=>{const old=s.list('aiProviderSetting',contextId)[0]??null;fresh(old,input.expectedRevision);const data={enabled:input.enabled as boolean,changedBy:p.user.id};const row=old?s.update('aiProviderSetting',old.id,old.revision,data):s.create('aiProviderSetting',{id:newId(),contextId,data});audit(s,p,this.clock,contextId,'ai.provider.settings',row.id,{enabled:old?.data.enabled??true},data);return {ids:[row.id]};});return {...settingsView(s,contextId),ids:saved.ids};});}
 private claim(s:UnitOfWork,token:string|undefined,runId:string):Claim {
  const p=this.identity.principal(s,token),r=resolveAnalysis(s,p,runId,this.clock,true);
  if(r.data.state!=='queued'||s.list('aiAnalysisRun').filter(x=>x.data.state==='running'&&!!x.data.leaseUntil&&x.data.leaseUntil>this.clock()).length>=PROVIDER_LIMITS.concurrent)return {runId,attemptId:null,claimId:null};
  const attempts=s.list('aiProviderAttempt',r.row.contextId!),own=attempts.filter(a=>a.data.runId===runId);if(own.length>=PROVIDER_LIMITS.attempts)fail('RETRY_UNAVAILABLE',409,'이 실행의 최대 재시도 횟수에 도달했습니다.');
  if(attempts.filter(a=>a.data.actorId===p.user.id&&Date.parse(a.data.intentAt)>Date.parse(this.clock())-60000).length>=PROVIDER_LIMITS.actorContextPerMinute)fail('LOCAL_RATE_LIMIT',429,'이 컨텍스트의 분당 실행 제한에 도달했습니다. 입력을 유지한 채 잠시 후 다시 시도해 주세요.');
  const claimId=newId(),leaseUntil=new Date(Date.parse(this.clock())+PROVIDER_LIMITS.leaseMs).toISOString();
  const a=s.create('aiProviderAttempt',{id:newId(),contextId:r.row.contextId,data:{runId,sequence:own.length+1,actorId:p.user.id,claimId,phase:'intent',intentAt:this.clock(),dispatchedAt:null,leaseUntil,requestHash:null,inputBytes:null,approximateInputTokens:null,outcomeId:null}});
  s.update('aiAnalysisRun',runId,r.row.revision,{...r.data,state:'running',claimId,leaseUntil,startedAt:r.data.startedAt??this.clock(),endedAt:null,issue:null});this.hooks.fault?.('claim');return {runId,attemptId:a.id,claimId};
 }
 async start(token:string|undefined,inputIdValue:string,raw:Record<string,unknown>){
  const input=obj(raw,['inputVersionId','extractionRunId','expectedRunId','corpusReleaseId','corpusManifestHash','engine','idempotencyKey']),inputId=id(inputIdValue),versionId=id(input.inputVersionId),extractionRunId=id(input.extractionRunId),corpusId=id(input.corpusReleaseId);str(input.corpusManifestHash,64);str(input.idempotencyKey);if(input.expectedRunId!==null)id(input.expectedRunId);if(input.engine!=='provider')fail('VALIDATION',422,'외부 AI 실행 방식을 확인해 주세요.');
  const claim=await this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),source=extractionSource(s,p,inputId,versionId,extractionRunId,this.clock),contextId=source.input.contextId!;reviewAccess(s,p,contextId,this.clock,true);const corpus=loadCorpus(s),setting=providerSetting(s,contextId),config=this.config();
   const saved=receipt(s,p,contextId,`ai.provider.start:${inputId}:${versionId}`,input,()=>{
    if(corpus.id!==corpusId||corpus.manifestHash!==input.corpusManifestHash)fail('CORPUS_CHANGED',409,'현행 근거 버전을 확인해 주세요.');
    const previous=s.list('aiAnalysisRun',contextId).filter(r=>r.data.inputVersionId===versionId).sort((a,b)=>b.data.attempt-a.data.attempt)[0];if((previous?.id??null)!==input.expectedRunId)fail('CONFLICT',409,'현재 실행을 다시 확인해 주세요.');
    if(previous){const summary=runSummary(previous,this.clock),plan=s.get('aiProviderPlan',previous.id);if(['running','interrupted'].includes(summary.state))fail('RUN_ACTIVE',409,'현재 실행 또는 중단된 외부 호출 기록을 확인해 주세요.');if(plan&&previous.data.extractionRunId===extractionRunId&&previous.data.corpusReleaseId===corpus.id&&plan.data.model===(config.config?.model??'unconfigured')&&plan.data.settingRevision===setting.revision&&plan.data.promptVersion===PROMPT_VERSION&&plan.data.baseURL===(config.config?.baseURL??'https://api.openai.com/v1'))return {ids:[previous.id]};if(summary.state==='queued')fail('RUN_ACTIVE',409,'현재 대기 실행을 먼저 확인해 주세요.');}
    if(s.list('aiAnalysisRun').filter(r=>r.data.state==='queued').length>=PROVIDER_LIMITS.queued)fail('QUEUE_FULL',503,'분석 대기 작업이 많습니다. 잠시 후 다시 시도해 주세요.');
    const run=s.create('aiAnalysisRun',{id:newId(),contextId,data:{inputId,inputVersionId:versionId,extractionRunId,extractionSnapshotId:source.snapshotRow.id,snapshotHash:source.snapshot.snapshotHash,corpusReleaseId:corpus.id,corpusManifestHash:corpus.manifestHash,engine:'provider',modelId:config.config?.model??'unconfigured',promptVersion:PROMPT_VERSION,providerCalled:false,taskId:source.content.submission?.taskId??null,createdBy:p.user.id,attempt:(previous?.data.attempt??0)+1,previousRunId:previous?.id??null,state:'queued',claimId:null,leaseUntil:null,startedAt:null,endedAt:null,resultId:null,issue:null}});
    s.create('aiProviderPlan',{id:run.id,contextId,data:{runId:run.id,settingRevision:setting.revision,settingsEnabled:setting.enabled,model:run.data.modelId,baseURL:config.config?.baseURL??'https://api.openai.com/v1',promptVersion:PROMPT_VERSION,maxOutputTokens:PROVIDER_LIMITS.maxOutputTokens,timeoutMs:PROVIDER_LIMITS.timeoutMs,pricingVersion:PRICING_VERSION}});return {ids:[run.id]};
   });return this.claim(s,token,saved.ids[0]);
  });return this.execute(token,claim);
 }
 async retry(token:string|undefined,runId:string,raw:Record<string,unknown>){
  const input=obj(raw,['expectedRevision','idempotencyKey','acknowledgeUnknown','restartConfiguration']);str(input.idempotencyKey);if(input.acknowledgeUnknown!==undefined&&typeof input.acknowledgeUnknown!=='boolean')fail('VALIDATION',422,'불확실한 외부 처리에 대한 재시도 선택을 확인해 주세요.');
  if(input.restartConfiguration!==undefined&&typeof input.restartConfiguration!=='boolean')fail('VALIDATION',422,'서버 설정 확인 후 재시도 선택을 확인해 주세요.');
  const claim=await this.identity.repo.transaction(s=>{
   const p=this.identity.principal(s,token),r=resolveAnalysis(s,p,id(runId),this.clock,true);if(r.data.engine!=='provider')unavailable();let claimed:Claim={runId,attemptId:null,claimId:null};
   receipt(s,p,r.row.contextId!,`ai.provider.retry:${runId}`,input,()=>{
    fresh(r.row,input.expectedRevision);const attempts=s.list('aiProviderAttempt',r.row.contextId!).filter(a=>a.data.runId===runId).sort((a,b)=>b.data.sequence-a.data.sequence),last=attempts[0],outcome=last?.data.outcomeId?s.get('aiProviderOutcome',last.data.outcomeId):null,plan=s.get('aiProviderPlan',runId);if(!plan||!last)unavailable();
    if(attempts.length>=PROVIDER_LIMITS.attempts)fail('RETRY_UNAVAILABLE',409,'이 실행의 최대 시도 횟수에 도달했습니다.');
    if(!outcome){
     if(r.data.state!=='running'||last.data.leaseUntil>this.clock())fail('RUN_ACTIVE',409,'현재 실행이 아직 처리 중입니다.');
     if(input.acknowledgeUnknown!==true)providerFail('RESPONSE_UNKNOWN');
     this.outcome(s,{runId,attemptId:last.id,claimId:last.data.claimId},emptyTransport('RESPONSE_UNKNOWN',true),false,'not_judged');
    }else{
     const o=outcomeData(outcome.data,plan.data.model);const configurationRestart=input.restartConfiguration===true&&configurationIssue(o.issue);if(configurationRestart){const cfg=this.config();if(cfg.issue)providerFail(cfg.issue);const setting=providerSetting(s,r.row.contextId!);if(!setting.enabled)providerFail('DISABLED');if(setting.revision!==plan.data.settingRevision||cfg.config!.model!==plan.data.model||cfg.config!.baseURL!==plan.data.baseURL)providerFail('SETTINGS_CHANGED');}
     if(r.data.state!=='failed'||!transient(o.issue)&&!configurationRestart)fail('RETRY_UNAVAILABLE',409,'현재 오류는 이 실행에서 재시도할 수 없습니다.');
     if(o.remoteOutcomeUnknown&&input.acknowledgeUnknown!==true)providerFail('RESPONSE_UNKNOWN');
    }
    s.update('aiAnalysisRun',runId,r.row.revision,{...r.data,state:'queued',issue:null,claimId:null,leaseUntil:null});claimed=this.claim(s,token,runId);return {ids:[runId]};
   });return claimed;
  });return this.execute(token,claim);
 }
 private current(s:UnitOfWork,token:string|undefined,claim:Claim){const p=this.identity.principal(s,token),r=resolveAnalysis(s,p,claim.runId,this.clock,true),a=s.get('aiProviderAttempt',claim.attemptId!),plan=s.get('aiProviderPlan',claim.runId);if(!a||!plan)unavailable();const d=attemptData(a.data),basis=planData(plan.data),setting=providerSetting(s,r.row.contextId!),config=this.config(),corpus=loadCorpus(s);
  if(r.data.state!=='running'||r.data.claimId!==claim.claimId||d.claimId!==claim.claimId||d.leaseUntil<=this.clock())throw new ProviderFailure('INTERRUPTED');
  if(setting.revision!==basis.settingRevision)throw new ProviderFailure('SETTINGS_CHANGED');if(!setting.enabled)throw new ProviderFailure('DISABLED');if(config.issue)throw new ProviderFailure(config.issue);if(config.config!.model!==basis.model||config.config!.baseURL!==basis.baseURL)throw new ProviderFailure('SETTINGS_CHANGED');
  if(corpus.id!==r.data.corpusReleaseId||corpus.manifestHash!==r.data.corpusManifestHash)throw new ProviderFailure('CORPUS_CHANGED');return {p,r,a,d,basis,config:config.config!,corpus};
 }
 private async execute(token:string|undefined,claim:Claim){if(claim.attemptId){let response:TransportResult=emptyTransport('ENGINE_ERROR');try{
   const loaded=await this.identity.repo.transaction(s=>this.current(s,token,claim));const source=new AiInputService(this.identity,this.directory),prepared=await source.prepareTransfer(token,loaded.r.data.inputId,loaded.r.data.extractionRunId);if(!prepared.allowed)throw new ProviderFailure(prepared.reason==='TOKEN_LIMIT'?'INPUT_LIMIT':'EXTERNAL_USE_DENIED');if(prepared.payload.extractionHash!==loaded.r.data.snapshotHash)throw new ProviderFailure('SOURCE_CHANGED');const request=providerRequest(loaded.basis.model,prepared.payload,loaded.corpus),requestHash=sha256(JSON.stringify(request));
   await this.hooks.afterPrepare?.();
   await this.identity.repo.transaction(s=>{const c=this.current(s,token,claim);s.update('aiProviderAttempt',c.a.id,c.a.revision,{...c.d,requestHash,inputBytes:prepared.technicalEstimate.utf8Bytes,approximateInputTokens:Buffer.byteLength(JSON.stringify(request))});});
   response=await(this.hooks.transport??openaiTransport)(loaded.config,request,async()=>{
    const latest=await source.prepareTransfer(token,loaded.r.data.inputId,loaded.r.data.extractionRunId);if(!latest.allowed)throw new ProviderFailure('EXTERNAL_USE_DENIED');if(sha256(JSON.stringify(providerRequest(loaded.basis.model,latest.payload,loaded.corpus)))!==requestHash)throw new ProviderFailure('SOURCE_CHANGED');await this.identity.repo.transaction(s=>this.current(s,token,claim));
   },async()=>{await this.identity.repo.transaction(s=>{const a=s.get('aiProviderAttempt',claim.attemptId!),r=s.get('aiAnalysisRun',claim.runId);if(!a||!r||a.data.claimId!==claim.claimId||r.data.claimId!==claim.claimId)throw new ProviderFailure('INTERRUPTED');s.update('aiProviderAttempt',a.id,a.revision,{...attemptData(a.data),phase:'dispatched',dispatchedAt:this.clock()});s.update('aiAnalysisRun',r.id,r.revision,{...runData(r.data),providerCalled:true});});});
   await this.hooks.afterResponse?.();const after=await source.prepareTransfer(token,loaded.r.data.inputId,loaded.r.data.extractionRunId);if(!after.allowed||after.payload.extractionHash!==prepared.payload.extractionHash)throw new ProviderFailure('SOURCE_CHANGED');
   await this.identity.repo.transaction(s=>{const c=this.current(s,token,claim);let validated:ReturnType<typeof validateAnalysisResult>|null=null;if(!response.issue){try{if(!response.rawCandidate||!matchesSchema(JSON.parse(response.rawCandidate)))throw Error('schema');validated=validateAnalysisResult(response.rawCandidate,c.r.snapshot,c.r.row.contextId!,c.r.data.snapshotHash,c.corpus,c.corpus.sources);}catch{response={...response,issue:'PARSE_ERROR'};}}
    const outcome=this.outcome(s,claim,response,validated!==null,!validated?.findings.length||validated?.status==='unconfirmed'||validated?.status==='out_of_scope'||validated?.status==='unread'?'insufficient':validated?'confirmed':'not_judged');let resultId:string|null=null;
    if(validated){resultId=s.create('aiAnalysisResult',{id:newId(),contextId:c.r.row.contextId,data:{runId:claim.runId,raw:response.rawCandidate!,rawHash:sha256(response.rawCandidate!),payload:JSON.stringify(validated),resultHash:contentHash(validated)}}).id;}
    const r=s.get('aiAnalysisRun',claim.runId)!;s.update('aiAnalysisRun',r.id,r.revision,{...runData(r.data),state:resultId?'finished':'failed',resultId,issue:resultId?null:'ENGINE_ERROR',endedAt:this.clock(),leaseUntil:null});audit(s,c.p,this.clock,r.contextId!,'ai.provider.finished',r.id,{}, {outcomeId:outcome.id,issue:response.issue});this.hooks.fault?.('result');
   });
  }catch(error){const issue:ProviderIssue=error instanceof ProviderFailure?error.issue:error instanceof AuthError&&[401,403,404].includes(error.status)?'ACCESS_CHANGED':'ENGINE_ERROR';await this.identity.repo.transaction(s=>{const a=s.get('aiProviderAttempt',claim.attemptId!),r=s.get('aiAnalysisRun',claim.runId);if(!a||!r||a.data.outcomeId||r.data.claimId!==claim.claimId)return;this.outcome(s,claim,{...response,issue,rawCandidate:null},false,'not_judged');s.update('aiAnalysisRun',r.id,r.revision,{...runData(r.data),state:'failed',issue:issue==='ACCESS_CHANGED'?'ACCESS_CHANGED':issue==='SOURCE_CHANGED'?'SOURCE_CHANGED':issue==='CORPUS_CHANGED'?'CORPUS_CHANGED':'ENGINE_ERROR',endedAt:this.clock(),leaseUntil:null});});if(error instanceof AuthError&&[401,403,404].includes(error.status))throw error;}
  }
  return this.identity.repo.transaction(s=>({runId:claim.runId,detail:analysisDetail(s,this.identity.principal(s,token),claim.runId,this.clock)}));
 }
 private outcome(s:UnitOfWork,claim:Claim,response:TransportResult,schemaValid:boolean,grounding:'confirmed'|'insufficient'|'not_judged') {const a=s.get('aiProviderAttempt',claim.attemptId!),plan=s.get('aiProviderPlan',claim.runId);if(!a||!plan)unavailable();const row=s.create('aiProviderOutcome',{id:newId(),contextId:a.contextId,data:{...response,attemptId:a.id,runId:claim.runId,endedAt:this.clock(),schemaValid,grounding,cost:estimateCost(response.usage,plan.data.model,response.responseModel,response.serviceTier)}});s.update('aiProviderAttempt',a.id,a.revision,{...attemptData(a.data),phase:'settled',outcomeId:row.id});return row;}
}
