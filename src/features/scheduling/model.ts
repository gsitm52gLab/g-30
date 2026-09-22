import type { ScheduleContent, ScheduleDetail, ScheduleList } from '@/server/scheduling/contracts';
import type { SchedulePresentation, DateTimeFields } from './presentation';
export type Row = ScheduleList['items'][number];
export const stateLabels = { open: '진행 중', done: '일정 행동 종료', cancelled: '일정 취소' };
export const policyLabels = { task_assignees: '현재 업무 주·공동 브랜드 담당자', explicit_action_owner: '명시한 업무 행동 담당자', external_gsg: 'GSG의 외부 진행 확인' };
const reasons: Record<string, string> = { source_schedule_only: '원 업무에서 확인하는 일정', other_recipient: '현재 다른 담당자의 행동', inactive_schedule: '종료·취소된 일정', source_unavailable: '원 자료 확인 필요', task_inactive: '업무 종료·취소·보류', not_required: '현재 필수 자료 없음', no_remaining: '남은 필수 자료 없음', participation_inactive: '현재 참여 대상 아님', external_wait_ended: '외부 대기 해소', needs_assignment: '담당자 배정 필요', recipient_inactive: '활성 담당자 확인 필요', source_denied: '현재 원 자료 접근 불가', wrong_recipient_role: '행동 담당 범위 확인 필요', unresolved_conflict: '원문 충돌 확인 전 · 알림 제외', undated: '날짜 미정 · 알림 제외', needs_confirmation: '날짜 확인 필요 · 알림 제외', not_due: '현재 알림 기준일 아님' };
export function presentation(r: Row): SchedulePresentation {
    const content: ScheduleContent = { taskId: r.taskId ?? '', title: r.title, kind: r.kind as ScheduleContent['kind'], visibility: r.visibility, deadline: r.deadline, statements: [], conflicts: r.unresolvedConflict ? [{ id: 'source-conflict', statementIds: [], state: 'unresolved', resolution: '' }] : [] };
    return { id: r.logicalKey, content, taskLabel: '연결 업무 보기', taskHref: r.taskId ? `/tasks/${encodeURIComponent(r.taskId)}?context=${encodeURIComponent(r.contextId)}` : null, detailHref: r.actionUrl, confirmationActorLabel: r.confirmationParty.label, actionOwnerLabels: r.actionOwners.map(a => a.label), recipientPolicyLabel: policyLabels[r.recipientPolicy], nextAction: r.nextAction, calendar: r.calendar, activityLabel: r.active ? '진행 대상' : '현재 진행 대상 아님', reminderLabel: r.reminder.eligible ? '현재 본인 알림 대상 · 앱 확인 시 처리' : reasons[r.reminder.reason] ?? '현재 상태 확인', sourceLabel: r.source.kind === 'manual' ? '직접 기록한 일정' : '원 업무에서 관리하는 일정', sourceHref: r.actionUrl };
}
export function blank(taskId = ''): ScheduleContent { return { taskId, title: '', kind: 'external_check', visibility: 'public', deadline: { value: null, precision: 'date', timezone: 'Asia/Seoul', certainty: 'needs_confirmation', source: '', sourceVersion: '', responsibleUserId: '', raw: '' }, statements: [], conflicts: [] }; }
export function localFields(d: ScheduleContent['deadline']): DateTimeFields {
    if (!d.value || d.precision === 'date')
        return { local: '', offset: '' };
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: d.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(new Date(d.value));
    const p = (k: Intl.DateTimeFormatPartTypes) => f.find(x => x.type === k)?.value ?? '';
    return { local: `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`, offset: p('timeZoneName').replace('GMT', '') || 'Z' };
}
export function history(d: ScheduleDetail) { return d.versions.map(v => ({ id: v.id, versionLabel: `v${v.sequence}`, changedAtLabel: v.changedAt, actorLabel: v.changedByLabel, changeLabel: `${stateLabels[v.state]}${v.reason ? ' · ' + v.reason : ''}`, content: v.content, confirmationActorLabel: v.content.deadline.responsibleUserId === d.calendar.confirmationParty.id ? d.calendar.confirmationParty.label : '이전 확인 책임자' })); }
