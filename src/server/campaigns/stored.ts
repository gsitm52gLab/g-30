import { fail } from '@/server/auth/errors';
import * as parse from '@/domain/campaigns/validate';
import { content } from '@/domain/tasks/validate';
type Shape='string'|'boolean'|'number'|{[key:string]:Shape}|readonly[Shape]|{nullable:Shape};
const arr=(s:Shape):Shape=>[s];const nil=(s:Shape):Shape=>({nullable:s});
export function corrupt():never{fail('STORAGE_UNAVAILABLE',503,'저장된 행사 기록을 확인할 수 없습니다. 원본을 보존하고 GSG에 확인을 요청해 주세요.');}
export function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))corrupt();return v as Record<string,unknown>;}
export function text(v:unknown):string{if(typeof v!=='string')corrupt();return v;}
export function integer(v:unknown,min=0):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)corrupt();return v;}
export function nullableText(v:unknown):string|null{return v===null?null:text(v);}
function pick(v:unknown,s:Shape):unknown{
 if(typeof s==='string'){if(typeof v!==s)corrupt();return v;}
 if(Array.isArray(s)){if(!Array.isArray(v))corrupt();return v.map(x=>pick(x,s[0]));}
 const shape=s as {[key:string]:Shape};if('nullable' in shape)return v===null?null:pick(v,shape.nullable);
 const d=object(v);return Object.fromEntries(Object.entries(shape).map(([k,c])=>[k,pick(d[k],c)]));
}
const deadline:Shape={value:nil('string'),precision:'string',timezone:'string',certainty:'string',source:'string',sourceVersion:'string',responsibleUserId:'string',raw:'string'};
const requirement:Shape={key:'string',label:'string',type:'string',required:'boolean',help:'string',unit:'string',options:arr('string'),productIds:arr('string'),condition:nil({key:'string',equals:'string'}),specifications:arr({text:'string',source:'string',version:'string',severity:'string',check:'string'})};
const request:Shape={title:'string',description:'string',purpose:'string',output:'string',productionResponsibility:'string',subtitleResponsibility:'string',originalResponsibility:'string',usePlace:'string',nextAction:'string',internalOriginal:'string',internalMemo:'string',deadline,requirements:arr(requirement),referenceFileIds:arr('string'),milestones:arr({id:'string',kind:'string',deadline,counterpart:'string',visibility:'string'}),links:arr({url:'string',description:'string',contentFixed:'boolean'})};
const source:Shape={source:'string',sourceVersion:'string',locator:'string',language:'string',originalText:'string',translatedText:'string',fileVersionIds:arr('string')};
const menuIdentity:Shape={catalogVersionId:'string',menuKey:'string',menuName:'string',menuNumber:'string'};
const product:Shape={productId:'string',productVersionId:'string',contextProductVersionId:'string',productUseId:nil('string'),sampleVariant:'string'};
const conditions:Shape={state:'string',sourceStatementIds:arr('string'),publicExplanation:'string',cost:{amount:nil('string'),currency:nil('string'),taxIncluded:'string'},discount:'string',points:'string',cancellationTerms:'string',schedules:arr({key:'string',kind:'string',deadline})};
const menu:Shape={identity:menuIdentity,sourceStatements:arr({id:'string',field:'string',rawValue:'string',source}),conflicts:arr({field:'string',statementIds:arr('string'),state:'string',resolution:'string'}),conditions,templateVersionId:nil('string'),request,products:arr(product),physical:arr({key:'string',destination:'string',purpose:'string',product,requestedQuantity:nil('string'),unit:'string',plannedShip:deadline,plannedArrival:deadline}),followups:arr({key:'string',kind:'string',requirementKey:'string',deadline})};
const reference:Shape={taskId:'string',requestId:'string',submissionId:'string',contentHash:'string',answer:nil({requirementKey:'string',productId:nil('string')}),fileVersionIds:arr('string'),productUseIds:arr('string')};
const date:Shape=nil({value:'string',precision:'string',timezone:'string'});
function parsed<T>(fn:()=>T):T{try{return fn();}catch{corrupt();}}
export const draft=(v:unknown)=>parsed(()=>parse.parseCampaignDraft(pick(v,{title:'string',menus:arr(menu)})));
export const sourceText=(v:unknown)=>parsed(()=>parse.parseSourceText(pick(v,source)));
export const submitted=(v:unknown)=>parsed(()=>parse.parseSubmittedReference(pick(v,reference)));
export const requestContent=(v:unknown)=>parsed(()=>content(pick(v,request)));
export function provider(v:unknown){const d=object(v);if(d.kind==='user')return {kind:'user' as const,userId:text(d.userId)};if(d.kind==='external_source')return {kind:'external_source' as const,label:text(d.label),source:text(d.source)};corrupt();}
export function external(v:unknown){const d=object(v);return parsed(()=>parse.parseExternalFact({axis:text(d.axis),value:text(d.value),requester:provider(d.requester),performedBy:provider(d.performedBy),occurredAt:pick(d.occurredAt,date),source:sourceText(d.source),note:text(d.note)}));}
export function physical(v:unknown){const d=object(v);const base={kind:text(d.kind),performedBy:provider(d.performedBy),occurredAt:pick(d.occurredAt,date),evidence:pick(d.evidence,arr(reference)),note:text(d.note)};return parsed(()=>parse.parsePhysicalFact(d.kind==='tracking'?{...base,carrier:text(d.carrier),trackingNumber:text(d.trackingNumber),trackingUrl:nullableText(d.trackingUrl)}:d.kind==='dispatch'?{...base,quantity:text(d.quantity),unit:text(d.unit),carrier:text(d.carrier),trackingNumber:text(d.trackingNumber)}:{...base,quantity:text(d.quantity),unit:text(d.unit),dispatchFactIds:pick(d.dispatchFactIds,arr('string'))}));}
export const identity=(v:unknown)=>parsed(()=>parse.parseMenuIdentity(pick(v,menuIdentity)));
export const occurred=(v:unknown)=>pick(v,date) as {value:string;precision:'date'|'datetime';timezone:string}|null;
export function publicMenu(v:unknown){
 const d=object(v),r=object(d.request),c=object(d.conditions);
 const normalized=parsed(()=>parse.parseMenuDraft(pick({...d,sourceStatements:[],conflicts:[],conditions:{...c,sourceStatementIds:[]},request:{...r,internalOriginal:'',internalMemo:''}},menu)));
 const issues=pick(d.confirmationIssues,arr({field:'string',state:'string'})) as {field:import('@/domain/campaigns/types').StatementField;state:'needs_confirmation'|'confirmed'}[];
 if(issues.some(x=>!parse.statementFields.includes(x.field)||!['needs_confirmation','confirmed'].includes(x.state)))corrupt();
 const {sourceStatementIds:_sources,...conditions}=normalized.conditions;void _sources;
 const {internalOriginal:_original,internalMemo:_memo,...request}=normalized.request;void _original;void _memo;
 return {identity:normalized.identity,conditions,templateVersionId:normalized.templateVersionId,request,products:normalized.products,physical:normalized.physical,followups:normalized.followups,confirmationIssues:issues};
}
