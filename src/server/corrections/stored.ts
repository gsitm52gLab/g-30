import { fail } from '@/server/auth/errors';
import { parseBatchDraft, parseReviewTarget, parseSaveOpinion, parseRecordReview } from '@/domain/corrections/validate';
export function corrupt():never { return fail('STORAGE_UNAVAILABLE',503,'저장된 검토 자료를 확인할 수 없습니다. 담당자에게 자료 확인을 요청해 주세요.'); }
export function text(v:unknown,max=20000):string { if(typeof v!=='string'||v.length>max)corrupt();return v as string; }
export function id(v:unknown):string { const x=text(v,160);if(!/^[\w-]{1,160}$/.test(x))corrupt();return x; }
export function integer(v:unknown,min=0):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)corrupt();return v as number;}
export function time(v:unknown):string {const x=text(v,50);if(!/^\d{4}-\d\d-\d\dT.*Z$/.test(x)||!Number.isFinite(Date.parse(x)))corrupt();return x;}
export function hash(v:unknown):string {const x=text(v,64);if(!/^[a-f0-9]{64}$/.test(x))corrupt();return x;}
export function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))corrupt();return v as Record<string,unknown>;}
export function array(v:unknown):unknown[]{if(!Array.isArray(v))corrupt();return v as unknown[];}
const pick=(v:unknown,keys:string[])=>{const x=object(v);return Object.fromEntries(keys.map(k=>[k,x[k]]));};
const targetKeys=['taskId','submissionId','requestId','submissionContentHash','answer','fileVersionIds','productUseIds','location'];
function targetShape(v:unknown){const x=pick(v,targetKeys);return {...x,answer:x.answer===null?null:pick(x.answer,['requirementKey','productId']),location:pick(x.location,['page','locator'])};}
function sourceShape(v:unknown){const x=object(v);return pick(x,x.kind==='internal_review'?['kind','reviewer','source']:x.kind==='external_opinion'?['kind','agency','reviewer','source']:['kind','runId','findingId','source']);}
const guarded=<T>(f:()=>T):T=>{try{return f();}catch{return corrupt();}};
export const target=(v:unknown)=>guarded(()=>parseReviewTarget(targetShape(v)));
export function opinion(v:unknown){return guarded(()=>{const x=pick(v,['target','source','originalText','internalFileVersionIds','receivedOn','conflictingOpinionVersionIds']);return parseSaveOpinion({taskId:target(x.target).taskId,idempotencyKey:'stored',opinionId:null,expectedRevision:0,opinion:{...x,target:targetShape(x.target),source:sourceShape(x.source)}}).opinion;});}
export function draft(v:unknown,publicOnly=false){return guarded(()=>{const x=pick(v,['title','summary','items','mode','pendingScopes','previousBatchVersionId']);return parseBatchDraft({...x,items:array(x.items).map(v=>{const i=pick(v,['key','target','publicSource','change','reason','publicDescription','priority','issue']);return {...i,target:targetShape(i.target),internalOpinionVersionIds:publicOnly?[]:object(v).internalOpinionVersionIds};}),pendingScopes:array(x.pendingScopes).map(p=>pick(p,['agency','scope','expectedOn']))});});}
export function review(v:unknown){return guarded(()=>{const x=pick(v,['taskId','target','source','scope','receivedOn','result','rationale','evidenceFileVersionIds','previousReviewId']);return parseRecordReview({...x,idempotencyKey:'stored',target:targetShape(x.target),source:sourceShape(x.source),scope:pick(x.scope,['medium','language','usePlace','productIds'])});});}
