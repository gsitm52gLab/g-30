import type { SearchList, SearchDetail, SearchKind } from '@/domain/search/types';
import type { AuditList, AuditItem } from '@/domain/audit/view';
import type { SearchService } from '@/server/search/service';
export type Scope = Awaited<ReturnType<SearchService['contexts']>>;
export type View = 'search'|'history'|'audit'|'audit-detail';
export type Data = {type:'search';value:SearchList}|{type:'history';value:SearchDetail;canAudit:boolean}|{type:'audit';value:AuditList;options:SearchList['filters']}|{type:'audit-detail';value:AuditItem};
export type Failure = {status:number;message:string};
export type Initial = {view:View;id:string;query:string;context:string;scope:Scope|null;data:Data|null;error:Failure|null};
export const kinds:Record<SearchKind,string>={task:'업무',project:'입점 프로젝트',template:'요청 템플릿',product:'상품',submission:'제출 자료',notice:'공지·가이드',inquiry:'문의',evidence:'증빙 자료',import:'Excel 가져오기',correction:'수정·검토',campaign:'PR 행사·실물',completion:'완료·외부 진행',schedule:'일정',notification:'알림',analysis:'AI 검토',corpus:'AI 근거'};
const statuses:Record<string,string>={draft:'초안',requested:'요청',in_progress:'진행 중',partial:'부분 제출',submitted:'제출',completed:'완료',active:'활성',archived:'보관',published:'공개',open:'열림',answered:'답변',external_wait:'외부 확인 대기',resolved:'해결',closed:'종료',pending:'대기',hold:'보류',cancelled:'취소',canceled:'취소',failed:'실패',success:'성공',read:'읽음',unread:'미읽음',done:'완료',unavailable:'확인 불가',confirmed:'확정',expected:'예정',declined:'불참',selected:'참가 선택',not_selected:'미선택',delivered:'전달',received:'수령'};
export const statusLabel=(value:string)=>statuses[value]??value;
export function timeLabel(value:string|null){if(!value)return '기록 시각 미확인';const date=new Date(value);return Number.isFinite(date.getTime())?`${new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)} UTC`:value;}
export const canAudit=(d:Data|null)=>d?.type==='search'?d.value.capabilities.audit:d?.type==='history'?d.canAudit:d?.type==='audit'||d?.type==='audit-detail';
export function canonical(query:string,context:string){const p=new URLSearchParams(query);if(!p.has('context')&&context)p.set('context',context);return p.toString();}
