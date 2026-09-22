'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import type {Initial,Failure} from './model';
import {canonical} from './model';
import {currentScope,readData,ReadError,deniedScopes,scopeKey} from './client';
export function useRead(initial:Initial){
 const params=useSearchParams(),query=canonical(params.toString(),initial.context),context=new URLSearchParams(query).get('context')??'';
 const [state,setState]=useState(()=>{const blocked=deniedScopes.has(scopeKey(initial.scope?.actor.id,initial.context));return {data:blocked?null:initial.data,scope:blocked?null:initial.scope,error:blocked?{status:403,message:'현재 계정의 조회 범위를 다시 확인해 주세요.'}:initial.error,key:initial.query,busy:false,denied:blocked||!!initial.error&&[401,403,404].includes(initial.error.status)};});
 const life=useRef({mounted:false,seq:0,generation:0,halted:false});
 const refresh=useCallback(async()=>{
  const g=life.current.generation,ticket=++life.current.seq;
  const active=()=>life.current.mounted&&!life.current.halted&&g===life.current.generation&&ticket===life.current.seq;
  if(!context||life.current.halted)return;
  setState(old=>({...old,busy:true,error:null}));
  try{
   await currentScope(context,initial.scope?.actor.id);if(!active())return;
   const data=await readData(initial.view,query,initial.id);if(!active())return;
   const scope=await currentScope(context,initial.scope?.actor.id);if(!active())return;
   deniedScopes.delete(scopeKey(scope.actor.id,context));setState({data,scope,error:null,key:query,busy:false,denied:false});
  }catch(e){if(!active())return;const error:Failure={status:e instanceof ReadError?e.status:503,message:e instanceof Error?e.message:'연결을 확인한 뒤 다시 조회해 주세요.'};const denied=[401,403,404].includes(error.status);if(denied){deniedScopes.add(scopeKey(initial.scope?.actor.id,context));life.current.halted=true;life.current.generation++;}
   setState(old=>({...old,data:null,scope:denied?null:old.scope,error,key:query,busy:false,denied}));
  }
 },[context,query,initial.scope,initial.view,initial.id]);
 useEffect(()=>{const live=life.current;live.mounted=true;live.generation++;live.halted=!!initial.error&&[401,403,404].includes(initial.error.status);
  void Promise.resolve().then(refresh);const focus=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=setInterval(focus,30000);
  return()=>{live.mounted=false;live.generation++;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[refresh,initial.error]);
 function navigate(next:URLSearchParams){if(life.current.halted)return;const url=`${initial.view==='audit'?'/audit':'/search'}?${next}`;if(next.toString()===query)void refresh();else{life.current.seq++;window.history.pushState(null,'',url);}}
 return {query,context,...state,data:state.key===query?state.data:null,refresh,navigate};
}
