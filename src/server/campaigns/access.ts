import type { Clock,UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize,decide,activeMember } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { taskScope } from '@/server/policy/projection';
import { fail,unavailable } from '@/server/auth/errors';
import type { Provider } from '@/domain/submissions/types';
export function campaignTask(s:UnitOfWork,p:Principal,taskId:string,clock:Clock,action:'read'|'manage'|'respond'='read'){
 const task=s.get('task',taskId);if(!task?.contextId)unavailable();authorize(s,p,'task.read',taskScope(task),clock);
 if(action==='manage')authorize(s,p,'task.manage',taskScope(task),clock);
 if(action==='respond')authorize(s,p,'submission.write',taskScope(task),clock);
 return task;
}
export function manager(s:UnitOfWork,p:Principal,taskId:string,clock:Clock){const task=campaignTask(s,p,taskId,clock);return p.user.data.role==='gsg'&&decide(s,p,'task.manage',taskScope(task),clock).allowed;}
export function manageCatalog(s:UnitOfWork,p:Principal,contextId:string,clock:Clock){authorize(s,p,'context.read',contextResource(contextId),clock);if(p.user.data.role!=='gsg')fail('FORBIDDEN',403,'카탈로그 원문은 GSG가 관리합니다.');authorize(s,p,'task.manage',{...contextResource(contextId),kind:'task'},clock);}
export function provider(s:UnitOfWork,p:Principal,contextId:string,value:Provider,self=false):Provider{
 if(self&&p.user.data.role==='brand'&&(value.kind!=='user'||value.userId!==p.user.id))fail('FORBIDDEN',403,'브랜드 회신의 제공자는 현재 사용자입니다.');
 if(value.kind==='user'&&(!activeMember(s,value.userId,contextId)||s.get('user',value.userId)?.data.status!=='active'))fail('VALIDATION',422,'현재 컨텍스트의 활성 제공자를 선택해 주세요.');
 return value;
}
export function resolveCampaign(s:UnitOfWork,p:Principal,id:string,clock:Clock,action:'read'|'manage'|'respond'='read'){
 const row=s.get('campaign',id);if(!row)unavailable();const task=campaignTask(s,p,row.data.taskId,clock,action);if(row.contextId!==task.contextId)unavailable();
 if(!row.data.currentVersionId&&!manager(s,p,task.id,clock))unavailable();return {row,task};
}
