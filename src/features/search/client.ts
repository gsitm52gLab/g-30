'use client';
import type { Scope,Data,View } from './model';
import type { SearchList,SearchDetail } from '@/domain/search/types';
import type { AuditList,AuditItem } from '@/domain/audit/view';
// Scope tombstones survive client route changes; a held old RSC payload cannot reopen a denied record.
export const deniedScopes=new Set<string>();
export const scopeKey=(actor:string|undefined,context:string)=>`${actor??''}:${context}`;
export class ReadError extends Error{constructor(message:string,public status:number){super(message);}}
export async function read<T>(url:string):Promise<T>{const r=await fetch(url,{cache:'no-store'}),value=await r.json().catch(()=>null);if(!r.ok)throw new ReadError(value?.error?.message??'자료를 불러오지 못했습니다. 같은 조건으로 다시 조회해 주세요.',r.status);if(value===null)throw new ReadError('응답을 읽지 못했습니다. 같은 조건으로 다시 조회해 주세요.',503);return value as T;}
export async function currentScope(context:string,actor?:string){const scope=await read<Scope>('/api/search/contexts');if((actor!==undefined&&scope.actor.id!==actor)||!scope.contexts.some(c=>c.id===context))throw new ReadError('현재 계정의 조회 범위를 다시 확인해 주세요.',403);return scope;}
export async function readData(view:View,query:string,id:string):Promise<Data>{
 const context=new URLSearchParams(query).get('context')??'';
 if(view==='search')return {type:view,value:await read<SearchList>(`/api/search?${query}`)};
 if(view==='history'){const [value,options]=await Promise.all([read<SearchDetail>(`/api/search/history?${query}`),read<SearchList>(`/api/search?${new URLSearchParams({context})}`)]);return {type:view,value,canAudit:options.capabilities.audit};}
 if(view==='audit'){const [value,options]=await Promise.all([read<AuditList>(`/api/audit?${query}`),read<SearchList>(`/api/search?${new URLSearchParams({context})}`)]);return {type:view,value,options:options.filters};}
 return {type:'audit-detail',value:await read<AuditItem>(`/api/audit/${encodeURIComponent(id)}?${query}`)};
}
