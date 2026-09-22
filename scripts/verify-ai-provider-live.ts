/** One author real-provider call through the normal production route; never used by default tests. */
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {ProviderHarness,prepare,providerStart,sha} from './verify-ai-provider-support';
import {matchesSchema} from '@/domain/ai-provider/schema';
import {SYNTHETIC_TEXT} from '@/server/ai-input/provenance';
import type {AiReviewDetail} from '@/server/ai-review/contracts';
const root=path.resolve(process.env.AI_PROVIDER_ROOT??'.local/g17-live');mkdirSync(root,{recursive:true});const h=new ProviderHarness(root,'sqlite',Number(process.env.E2E_PORT??4247)),report=path.resolve(process.env.AI_PROVIDER_REPORT??path.join(h.directory,'live-report.json'));
const checks:{id:string;requirements:string[];status:'PASS'|'FAIL';level:string}[]=[];let failure:string|undefined,runId:string|undefined,attemptsCreated=0;
function check(id:string,value:unknown){checks.push({id,requirements:['AC-17-05','AC-17-04','SA-62'],status:value?'PASS':'FAIL',level:'actual configured OpenAI normal production HTTP'});assert(value,id);}
try{
 await h.setup();await h.start('live');let brand=h.client(),gsg=h.client();await brand.login('luna@example.test');await gsg.login();
 const safe=JSON.parse(readFileSync(path.join(h.directory,'safe-live-config.json'),'utf8'));check('L01 configured model and official host/key presence safely recorded',!!safe.model&&safe.baseURL.startsWith('https://api.openai.com/v1')&&safe.keyPresent);
 const f=await prepare(brand,gsg);check('L02 actual G15 approved exact text extraction remains server-owned',f.input.version.content.text===SYNTHETIC_TEXT);
 const r=await providerStart(gsg,f);runId=r.runId;attemptsCreated=r.detail.provider?.attempts.length??0;writeFileSync(path.join(h.directory,'live-detail-private.json'),JSON.stringify(r.detail,null,2),{mode:0o600});
 check('L03 actual provider completed valid result and response ID',r.detail.state==='finished'&&r.detail.providerCalled&&r.detail.engine==='provider'&&r.detail.provider?.attempts.length===1&&!!r.detail.provider.attempts[0].responseId&&r.detail.provider.attempts[0].schemaValid);
 check('L04 exact approved input range and model/corpus identities',r.detail.snapshot.text===SYNTHETIC_TEXT&&r.detail.inputVersionId===f.input.version.id&&r.detail.modelId===safe.model&&r.detail.snapshotHash===r.detail.snapshot.snapshotHash&&r.detail.corpusManifestHash===f.body.corpusManifestHash);
 const raw=await gsg.get<{raw:string;rawHash:string}>(`/api/ai-review/runs/${runId}/raw`);check('L05 independent schema/raw hash; grounds or explicit insufficient evidence, never legal approval',matchesSchema(JSON.parse(raw.raw))&&sha(raw.raw)===raw.rawHash&&r.detail.result!.requiresHumanReview&&!r.detail.result!.legalApproval&&['confirmed','insufficient'].includes(r.detail.provider!.attempts[0].grounding));
 const a=r.detail.provider!.attempts[0];check('L06 actual provided usage is recorded independently of nullable cost',a.usage!==null&&typeof a.usage.inputTokens==='number'&&typeof a.usage.outputTokens==='number'&&a.responseModel===safe.model&&a.cost?.estimated===true);
 const original=JSON.stringify(r.detail);await h.stop();await h.start('missing');brand=h.client();gsg=h.client();await brand.login('luna@example.test');await gsg.login();const reread=await gsg.get<AiReviewDetail>(`/api/ai-review/runs/${runId}`);check('L07 new PID and real relogin preserve immutable run/attempt/usage/result without resending',JSON.stringify(reread)===original&&h.processes[0].pid!==h.processes[1].pid);
}catch(e){failure=e instanceof Error?e.message:'author live verification failed';process.exitCode=1;}
finally{await h.stopAll();writeFileSync(report,JSON.stringify({candidate:h.candidate,cwd:h.cwd,session:'01a0c307-c975-75b1-b96a-5a5c4e448aec',checks,counts:{pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length,unit:'assertion'},notRun:Array.from({length:7},(_,i)=>'L0'+(i+1)).filter(id=>!checks.some(c=>c.id.startsWith(id))),runId,attemptsCreated,failure,transcript:h.transcript,processes:h.processes,directory:h.directory,mode:'sqlite',provider:'actual configured OpenAI; no intercepted transport',expertLegalAccuracy:'NOT_RUN',secrets:'no key value/prefix/suffix/hash copied or logged; root env read in memory only for child server injection'},null,2),{mode:0o600});console.log(JSON.stringify({report,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length,failure}));}
