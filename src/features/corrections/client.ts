'use client';
export class CorrectionError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export const denied=(e:unknown)=>e instanceof CorrectionError&&[401,403,404].includes(e.status);
export async function request<T>(url:string,body?:unknown,active:()=>boolean=()=>true):Promise<T>{
 const headers:Record<string,string>={};
 if(body!==undefined){const csrf=await fetch('/api/auth/csrf',{cache:'no-store'}),v=await csrf.json();if(!csrf.ok)throw new CorrectionError(v.error?.message??'로그인을 확인해 주세요.',csrf.status,v.error?.code??'AUTH');if(!active())throw new Error('요청 화면이 종료되었습니다.');headers['X-CSRF-Token']=v.csrfToken;if(!(body instanceof FormData))headers['Content-Type']='application/json';}
 const r=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw new CorrectionError(data?.error?.message??'연결을 확인한 뒤 다시 시도해 주세요.',r.status,data?.error?.code??'REQUEST_FAILED');if(!data)throw new Error('서버 응답을 읽지 못했습니다. 같은 요청으로 다시 확인해 주세요.');return data as T;
}
