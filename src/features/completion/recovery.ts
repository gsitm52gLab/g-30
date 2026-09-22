import type {Recovery} from './model';
const prefix='gs-hale:completion:';
const key=(v:Pick<Recovery,'actorId'|'contextId'|'taskId'>)=>prefix+JSON.stringify([v.actorId,v.contextId,v.taskId]);
export function clearRecovery(){try{for(const k of Object.keys(sessionStorage))if(k.startsWith(prefix))sessionStorage.removeItem(k);}catch{}}
export function readRecovery(scope:Pick<Recovery,'actorId'|'contextId'|'taskId'>):Recovery|null{try{for(const k of Object.keys(sessionStorage)){if(!k.startsWith(prefix))continue;let v:Recovery;const raw=sessionStorage.getItem(k)??'';try{v=JSON.parse(raw);}catch{sessionStorage.removeItem(k);continue;}if(raw.length>400000||v.actorId!==scope.actorId||!Number.isFinite(v.at)||Date.now()-v.at>8*3600000){sessionStorage.removeItem(k);continue;}if(k===key(scope)&&v.forms&&typeof v.forms.memo==='string'&&typeof v.forms.reopenReason==='string'&&typeof v.forms.followupReason==='string')return v;}}catch{}return null;}
export function storeRecovery(v:Recovery){try{sessionStorage.setItem(key(v),JSON.stringify({...v,at:Date.now()}));}catch{/* In-memory intent stays available. */}}
