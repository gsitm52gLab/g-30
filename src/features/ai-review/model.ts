import type { AiReviewList, AiReviewWorkspace, AiReviewDetail, AiReviewCorpus, HumanReviewCommand, StartAnalysis, ReviewFinding } from '@/server/ai-review/contracts';
import type { CorrectionCommand } from '@/server/corrections/contracts';
export type View = { kind:'list'; data:AiReviewList } | { kind:'input'; data:AiReviewWorkspace } | { kind:'run'; data:AiReviewDetail } | { kind:'corpus'; data:AiReviewCorpus };
export type Selection = { contextId:string; kind:View['kind']; id?:string; versionId?:string; releaseId?:string };
export type Pending = { kind:'start'; url:string; body:StartAnalysis; receipt:string|null } | { kind:'review'; url:string; body:ReviewFinding; receipt:string|null } | { kind:'opinion'; url:string; body:CorrectionCommand; receipt:string|null };
export type Recovery = { actorId:string; scope:string; at:number; reviews:Record<string,HumanReviewCommand>; opinions:Record<string,{targetIndex:number;text:string}>; pending:Pending|null };
export const runLabels:Record<string,string>={queued:'분석 대기',running:'분석 중',finished:'분석 결과 저장됨',failed:'분석 실패',interrupted:'분석 중단'};
export const issueLabels:Record<string,string>={ACCESS_CHANGED:'현재 원본 또는 컨텍스트 권한을 확인할 수 없습니다.',SOURCE_CHANGED:'읽은 원본이 변경되었습니다.',CORPUS_CHANGED:'근거 자료 버전이 변경되었습니다.',RESULT_INVALID:'결과의 구조 또는 원문 위치를 확인할 수 없습니다.',INTERRUPTED:'이전 분석이 끝나지 않았습니다.',ENGINE_ERROR:'분석을 처리하지 못했습니다.'};
export const decisions={accept:'수락',edit:'수정',reject:'기각'};
export const inputHref=(contextId:string,id:string,versionId:string)=>`/ai-review/inputs/${encodeURIComponent(id)}?context=${encodeURIComponent(contextId)}&versionId=${encodeURIComponent(versionId)}`;
export const runHref=(contextId:string,id:string)=>`/ai-review/runs/${encodeURIComponent(id)}?context=${encodeURIComponent(contextId)}`;
export const corpusHref=(contextId:string,id?:string)=>`/ai-review/corpus?context=${encodeURIComponent(contextId)}${id?`&releaseId=${encodeURIComponent(id)}`:''}`;
export function endpoint(s:Selection){if(s.kind==='list')return `/api/ai-review?contextId=${encodeURIComponent(s.contextId)}`;if(s.kind==='input')return `/api/ai-review/inputs/${s.id}${s.versionId?`?versionId=${encodeURIComponent(s.versionId)}`:''}`;if(s.kind==='run')return `/api/ai-review/runs/${s.id}`;return `/api/ai-review/corpus?contextId=${encodeURIComponent(s.contextId)}${s.releaseId?`&releaseId=${encodeURIComponent(s.releaseId)}`:''}`;}
export function pathname(s:Selection){return s.kind==='input'?`/ai-review/inputs/${s.id}`:s.kind==='run'?`/ai-review/runs/${s.id}`:s.kind==='corpus'?'/ai-review/corpus':'/ai-review';}
export const recoveryPrefix='gs-hale.ai-review.v1:';
export function recoveryKey(actorId:string,s:Selection){return recoveryPrefix+JSON.stringify([actorId,s.contextId,s.kind,s.id??'',s.versionId??'',s.releaseId??'']);}
export function purgeRecovery(){try{for(let n=sessionStorage.length-1;n>=0;n--){const key=sessionStorage.key(n);if(key?.startsWith(recoveryPrefix))sessionStorage.removeItem(key);}}catch{/* protected memory is still cleared */}}
export function readRecovery(key:string,actorId:string):Recovery|null{try{const v=JSON.parse(sessionStorage.getItem(key)||'null') as Recovery|null;return v&&v.actorId===actorId&&v.scope===key&&v.at>Date.now()-86400000&&v.reviews&&v.opinions?v:null;}catch{return null;}}
export function storeRecovery(value:Recovery){try{sessionStorage.setItem(value.scope,JSON.stringify({...value,at:Date.now()}));}catch{/* current input remains on screen */}}
