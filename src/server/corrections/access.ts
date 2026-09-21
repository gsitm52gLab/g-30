import type { Clock,UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize,decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { fail,unavailable } from '@/server/auth/errors';
import { ids } from '@/domain/tasks/validate';
export function correctionTask(s:UnitOfWork,p:Principal,taskId:string,clock:Clock,action:'read'|'manage'|'reflect'='read'){
    ids([taskId]);const task=s.get('task',taskId);if(!task?.contextId)unavailable();
    authorize(s,p,'task.read',taskScope(task),clock);
    if(action==='manage')authorize(s,p,'task.manage',taskScope(task),clock);
    if(action==='reflect'){authorize(s,p,'submission.write',taskScope(task),clock);if(p.user.data.role!=='brand')fail('FORBIDDEN',403,'반영 제출은 현재 브랜드 담당자가 기록합니다.');}
    return task;
}
export const canManage=(s:UnitOfWork,p:Principal,task:ReturnType<typeof correctionTask>,clock:Clock)=>decide(s,p,'task.manage',taskScope(task),clock).allowed;
