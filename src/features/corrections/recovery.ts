import type { CorrectionCommand } from '@/server/corrections/contracts';
import type { EditorState } from './model';
export const prefix='gs-hale:correction-recovery:';
export type Pending={body:CorrectionCommand;ids:string[]|null;conflict:boolean};
export type Recovery={actorId:string;contextId:string;taskId:string;at:number;editors:EditorState;pending:Pending|null};
const key=(v:Pick<Recovery,'actorId'|'contextId'|'taskId'>)=>prefix+JSON.stringify([v.actorId,v.contextId,v.taskId]);
export function clearRecovery(){try{for(const k of Object.keys(sessionStorage))if(k.startsWith(prefix))sessionStorage.removeItem(k);}catch{}}
export function readRecovery(scope:Pick<Recovery,'actorId'|'contextId'|'taskId'>):Recovery|null{try{for(const k of Object.keys(sessionStorage)){if(!k.startsWith(prefix))continue;const raw=sessionStorage.getItem(k)??'';let v:Recovery;try{v=JSON.parse(raw);}catch{sessionStorage.removeItem(k);continue;}if(raw.length>300000||v.actorId!==scope.actorId||!Number.isFinite(v.at)||Date.now()-v.at>8*3600000){sessionStorage.removeItem(k);continue;}if(k===key(scope)&&v.editors&&['public','opinions','draft','reviews'].includes(v.editors.tab)&&Array.isArray(v.editors.draft?.items)&&v.editors.actions&&typeof v.editors.actions==='object')return v;}return null;}catch{return null;}}
export function writeRecovery(v:Recovery){try{const raw=JSON.stringify(v);if(raw.length>300000)return '복구 입력의 크기를 넘었습니다. 서버에 저장해 주세요.';const keys=Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)&&k!==key(v));while(keys.length>=3)sessionStorage.removeItem(keys.shift()!);sessionStorage.setItem(key(v),raw);return '';}catch{return '이 브라우저에는 입력을 보관할 수 없습니다. 서버 저장을 확인해 주세요.';}}
