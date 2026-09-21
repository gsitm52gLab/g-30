import type { AiContent, AiVisibility, AssetReference, ProductReference, SubmissionReference } from './records';
import { INPUT_LIMITS } from './types';
import { fail } from '@/server/auth/errors';
export function obj(v: unknown, keys: string[]): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k=>!keys.includes(k))) fail('VALIDATION',422,'입력 항목과 형식을 확인해 주세요.'); return v as Record<string, unknown>; }
export function str(v: unknown, max=160, empty=false): string { if(typeof v!=='string'||!v.isWellFormed()||v.length>max||!empty&&!v.trim())fail('VALIDATION',422,'입력 내용과 길이를 확인해 주세요.');return v; }
export function id(v: unknown): string { const s=str(v);if(!/^[A-Za-z0-9_-]{1,160}$/.test(s))fail('VALIDATION',422,'자료 식별자를 확인해 주세요.');return s; }
export function visibility(v: unknown): AiVisibility {if(v!=='context'&&v!=='staff')fail('VALIDATION',422,'공개 범위를 선택해 주세요.');return v;}
const array=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)fail('VALIDATION',422,'선택 개수를 확인해 주세요.');return v;};
export function parseContent(value: unknown): AiContent {
 const v=obj(value,['title','scope','kind','text','sources','selectedPages','submission','products']),scope=obj(v.scope,['classification','language','media','use']);
 const s={classification:str(scope.classification,100),language:str(scope.language,40),media:str(scope.media,100),use:str(scope.use,1000)};
 if(!['text','pdf','images'].includes(String(v.kind)))fail('VALIDATION',422,'텍스트, PDF 또는 이미지를 선택해 주세요.');
 const kind=v.kind as AiContent['kind']; const sources=array(v.sources,INPUT_LIMITS.images).map<AssetReference>(x=>{const r=obj(x,['kind','assetId','fileVersionId']);if(r.kind==='upload'&&r.fileVersionId===undefined)return{kind:'upload',assetId:id(r.assetId)};if(r.kind==='submission_file'&&r.assetId===undefined)return{kind:'submission_file',fileVersionId:id(r.fileVersionId)};fail('VALIDATION',422,'자료의 정확한 출처를 선택해 주세요.');});
 if(new Set(sources.map(x=>JSON.stringify(x))).size!==sources.length)fail('VALIDATION',422,'같은 자료를 중복 선택할 수 없습니다.');
 const selectedPages=array(v.selectedPages,INPUT_LIMITS.selectedPages).map(p=>{if(!Number.isSafeInteger(p)||Number(p)<1||Number(p)>INPUT_LIMITS.documentPages)fail('VALIDATION',422,'PDF 페이지 범위를 확인해 주세요.');return Number(p);}).sort((a,b)=>a-b);
 if(new Set(selectedPages).size!==selectedPages.length)fail('VALIDATION',422,'페이지를 중복 선택할 수 없습니다.');
 const text=kind==='text'?str(v.text,INPUT_LIMITS.textCodePoints*2,true):null;
 if(kind==='text'&&(sources.length||selectedPages.length||!text?.trim()||[...text].length>INPUT_LIMITS.textCodePoints)||kind!=='text'&&v.text!==null||kind==='pdf'&&(sources.length!==1||!selectedPages.length)||kind==='images'&&(!sources.length||selectedPages.length))fail('VALIDATION',422,'입력 형식, 자료 개수 또는 선택 범위를 확인해 주세요.');
 let submission:SubmissionReference|null=null;
 if(v.submission!==null){const a=obj(v.submission,['taskId','requestId','submissionId','productUseIds']);submission={taskId:id(a.taskId),requestId:id(a.requestId),submissionId:id(a.submissionId),productUseIds:array(a.productUseIds,100).map(id)};}
 if(sources.some(s=>s.kind==='submission_file')&&!submission)fail('VALIDATION',422,'파일의 정확한 제출 버전을 선택해 주세요.');
 const products=array(v.products,100).map<ProductReference>(x=>{const p=obj(x,['productId','productVersionId','contextProductVersionId']);return{productId:id(p.productId),productVersionId:id(p.productVersionId),contextProductVersionId:id(p.contextProductVersionId)};});
 if(new Set(products.map(p=>p.productId)).size!==products.length||submission&&new Set(submission.productUseIds).size!==submission.productUseIds.length)fail('VALIDATION',422,'상품 선택이 중복되었습니다.');
 return{title:str(v.title,200),scope:s,kind,text,sources,selectedPages,submission,products};
}
