import type { NoticeContent } from '@/server/notices/contracts';
export type Recovery={content:NoticeContent;revision:number;pendingTasks:string[];intent:{fingerprint:string;key:string}|null;at:number};
const prefix='gs-hale:notice-edit:v1:';
export function recoveryKey(actor:string,context:string,id:string){return prefix+[actor,context,id].map(encodeURIComponent).join(':');}
export function saveRecovery(key:string,r:Recovery){try{const text=JSON.stringify(r);if(text.length<180000){const keys=Object.keys(sessionStorage).filter(k=>k.startsWith(prefix));for(const k of keys.slice(0,Math.max(0,keys.length-7)))if(k!==key)sessionStorage.removeItem(k);sessionStorage.setItem(key,text);}}catch{/* Storage denial does not claim persistence. */}}
export function clearRecovery(key:string){try{sessionStorage.removeItem(key);}catch{}}
export function readRecovery(key:string):Recovery|null{try{const text=sessionStorage.getItem(key);if(!text||text.length>180000)return null;const r=JSON.parse(text);if(!r||Date.now()-r.at>86400000||!Number.isInteger(r.revision)||typeof r.content?.title!=='string'||typeof r.content?.body!=='string'||!Array.isArray(r.content?.fileIds)||!Array.isArray(r.content?.taskIds)||!Array.isArray(r.pendingTasks)){clearRecovery(key);return null;}return r;}catch{clearRecovery(key);return null;}}

export function clearNoticeRecovery(context:string,id:string){try{const suffix=':'+encodeURIComponent(context)+':'+encodeURIComponent(id);for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix)&&key.endsWith(suffix))sessionStorage.removeItem(key);}catch{}}
