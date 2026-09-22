import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { IdentityService, Principal } from '@/server/auth/service';
import { object, str, enumValue } from '@/domain/tasks/validate';
import { commandKeys, external, hash, identifier } from '@/domain/completion/validate';
import { fail, unavailable } from '@/server/auth/errors';
import { newId, receipt, fresh, audit } from '@/server/products/store';
import { completionTask } from './access';
import { collectBasis, latestSubmission } from './collect';
import { completionWorkspace } from './read';
import { actorCheck, authorizedFile, exactSource } from './sources';
import { snapshotDTO, externalDTO } from './projection';
import * as safe from './stored';
export class CompletionService {
    constructor(public identity: IdentityService, private fault?: (stage: string) => void) { }
    get clock() { return this.identity.clock; }
    private async event(s: UnitOfWork, p: Principal, t: StoredRecord<'task'>, eventType: string, sourceVersionId: string) { (await s.create('domainEvent', { id: newId(), contextId: t.contextId, data: { eventType, targetId: t.id, sourceVersionId, actorId: p.user.id, at: this.clock() } })); }
    async workspace(token: string | undefined, taskId: string) { return this.identity.repo.transaction(async (s) => (await completionWorkspace(s, (await this.identity.principal(s, token)), taskId, this.clock))); }
    async snapshot(token: string | undefined, id: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await s.get('completionSnapshot', identifier(id)));
            if (!r)
                unavailable();
            return (await snapshotDTO(s, p, r, this.clock));
        });
    }
    async external(token: string | undefined, id: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await s.get('completionExternalAction', identifier(id)));
            if (!r)
                unavailable();
            return (await externalDTO(s, p, r, this.clock));
        });
    }
    async command(token: string | undefined, input: unknown) {
        const v = object(input, commandKeys), command = enumValue(v.command, ['complete', 'reopen', 'record_external', 'link_followup']), taskId = identifier(v.taskId), key = str(v.idempotencyKey, 160, true);
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), task = (await completionTask(s, p, taskId, this.clock, true)), contextId = task.contextId!;
            const next = v.followupTaskId === undefined ? null : (await completionTask(s, p, identifier(v.followupTaskId), this.clock, true));
            if (next && (next.contextId !== contextId || next.id === task.id))
                unavailable();
            let action: ReturnType<typeof external> | null = null;
            if (command === 'record_external') {
                action = external(v.action);
                (await actorCheck(s, task, action.requester));
                (await actorCheck(s, task, action.performer));
                (await exactSource(s, p, task, action.source, this.clock));
                for (const id of action.evidenceFileVersionIds)
                    (await authorizedFile(s, p, task, id, this.clock, action.visibility === 'public'));
            }
            return (await receipt(s, p, contextId, `completion.${command}:${task.id}`, { ...v, idempotencyKey: key }, async () => {
                fresh(task, v.expectedTaskRevision);
                if (command === 'complete') {
                    const expected = hash(v.expectedBasisHash), memo = str(v.memo ?? '', 4000);
                    if (task.data.status === 'completed')
                        fail('ALREADY_COMPLETED', 409, '이미 완료된 업무입니다. 완료 이력을 확인해 주세요.');
                    const collected = (await collectBasis(s, p, task, this.clock));
                    if (collected.basisHash !== expected)
                        fail('BASIS_CHANGED', 409, '요청·제출 또는 잔여 상태가 변경되었습니다. 입력을 유지하고 최신 완료 기준을 다시 확인해 주세요.');
                    const previous = (await s.list('completionSnapshot', contextId)).filter(r => r.data.taskId === task.id).sort((a, b) => safe.count(b.data.sequence, 1) - safe.count(a.data.sequence, 1))[0];
                    const row = (await s.create('completionSnapshot', { id: newId(), contextId, data: { taskId: task.id, sequence: previous ? safe.count(previous.data.sequence, 1) + 1 : 1, previousCompletionId: previous?.id ?? null, basisHash: collected.basisHash, taskRevision: task.revision, statusBefore: task.data.status, basis: collected.basis, memo, completedBy: p.user.id, completedAt: this.clock() } }));
                    (await s.update('task', task.id, task.revision, { ...task.data, status: 'completed' }));
                    (await audit(s, p, this.clock, contextId, 'task.manually_completed', task.id, { status: task.data.status }, { completionId: row.id, status: 'completed' }));
                    (await this.event(s, p, task, 'TASK_MANUALLY_COMPLETED', row.id));
                    return { ids: [row.id] };
                }
                if (command === 'reopen') {
                    const reason = str(v.reason, 2000, true), completionId = identifier(v.completionId), row = (await s.get('completionSnapshot', completionId)), latest = (await s.list('completionSnapshot', contextId)).filter(r => r.data.taskId === task.id).sort((a, b) => safe.count(b.data.sequence, 1) - safe.count(a.data.sequence, 1))[0];
                    if (!row || row.data.taskId !== task.id)
                        unavailable();
                    if (task.data.status !== 'completed' || latest?.id !== row.id)
                        fail('CONFLICT', 409, '현재 완료 버전을 확인한 뒤 사유를 입력해 재개해 주세요.');
                    const sub = (await latestSubmission(s, task)), status = sub?.data.requestId === task.data.currentRequestId ? (sub.data.mode === 'full' ? 'submitted' as const : 'partial' as const) : 'requested' as const;
                    const reopened = (await s.create('completionReopen', { id: newId(), contextId, data: { taskId: task.id, completionId: row.id, reason, resumedStatus: status, reopenedBy: p.user.id, reopenedAt: this.clock() } }));
                    (await s.update('task', task.id, task.revision, { ...task.data, status, resumeStatus: null }));
                    (await audit(s, p, this.clock, contextId, 'task.reopened', task.id, { status: 'completed', completionId: row.id }, { status, reopenId: reopened.id }));
                    (await this.event(s, p, task, 'TASK_REOPENED', reopened.id));
                    return { ids: [reopened.id] };
                }
                if (command === 'record_external') {
                    const rows = (await s.list('completionExternalAction', contextId)).filter(r => r.data.taskId === task.id), row = (await s.create('completionExternalAction', { id: newId(), contextId, data: { ...action!, taskId: task.id, sequence: Math.max(0, ...rows.map(r => safe.count(r.data.sequence, 1))) + 1, recordedBy: p.user.id, recordedAt: this.clock() } }));
                    (await audit(s, p, this.clock, contextId, 'external.action_recorded', task.id, {}, { externalActionId: row.id, effect: 'record_only' }));
                    (await this.event(s, p, task, 'EXTERNAL_ACTION_RECORDED', row.id));
                    return { ids: [row.id] };
                }
                const completionId = identifier(v.completionId), completion = (await s.get('completionSnapshot', completionId));
                if (!completion || completion.data.taskId !== task.id || !next)
                    unavailable();
                fresh(next, v.expectedFollowupRevision);
                const old = (await s.list('completionFollowup', contextId)).find(x => x.data.completionId === completion.id && x.data.followupTaskId === next.id);
                if (old)
                    return { ids: [old.id, next.id] };
                const row = (await s.create('completionFollowup', { id: newId(), contextId, data: { taskId: task.id, completionId: completion.id, followupTaskId: next.id, reason: str(v.reason ?? '', 2000), linkedBy: p.user.id, linkedAt: this.clock() } }));
                (await audit(s, p, this.clock, contextId, 'completion.followup_linked', task.id, {}, { completionId, followupTaskId: next.id }));
                (await this.event(s, p, task, 'COMPLETION_FOLLOWUP_LINKED', row.id));
                return { ids: [row.id, next.id] };
            }, () => this.fault?.(command)));
        });
    }
}
export type CompletionWorkspace = Awaited<ReturnType<CompletionService['workspace']>>;
export type CompletionSnapshot = Awaited<ReturnType<CompletionService['snapshot']>>;
export type ExternalAction = Awaited<ReturnType<CompletionService['external']>>;
