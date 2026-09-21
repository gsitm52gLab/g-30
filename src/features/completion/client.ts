export class CompletionError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export const isDenied=(e:unknown)=>e instanceof CompletionError && [401,403,404].includes(e.status);
export async function request<T>(url:string,body?:unknown,active:()=>boolean=()=>true):Promise<T>{
 const headers:Record<string,string>={};
 if(body!==undefined){const csrf=await request<{csrfToken:string}>('/api/auth/csrf');if(!active())throw Error('접근 상태가 변경되었습니다.');headers['X-CSRF-Token']=csrf.csrfToken;headers['Content-Type']='application/json';}
 if(!active())throw Error('접근 상태를 다시 확인해 주세요.');
 const r=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)}),v=await r.json().catch(()=>null);
 if(!r.ok)throw new CompletionError([401,403,404].includes(r.status)?'현재 자료를 열 수 없습니다.':typeof v?.error?.message==='string'?v.error.message:'연결을 확인하고 다시 시도해 주세요.',r.status,typeof v?.error?.code==='string'?v.error.code:'REQUEST_FAILED');
 if(v===null)throw Error('처리 결과를 확인하지 못했습니다. 같은 요청으로 확인해 주세요.');return v as T;
}
