import { StoreError, type RecordKind, type RecordInput, type SyncUnitOfWork as UnitOfWork } from '@/domain/records';
export function schedulingRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'schedule' && kind !== 'scheduleVersion') return;
    const bad = () => { throw new StoreError('INVALID_RECORD'); };
    if (!input.contextId || !s.get('context', input.contextId)) bad();
    if (kind === 'schedule') {
        const d = input.data as import('./records').ScheduleData, old = s.get('schedule', input.id);
        if (s.get('task', d.taskId)?.contextId !== input.contextId || !s.get('user', d.createdBy) || old && (old.data.taskId !== d.taskId || old.data.createdBy !== d.createdBy) || d.currentVersionId && s.get('scheduleVersion', d.currentVersionId)?.data.scheduleId !== input.id) bad();
    } else {
        const d = input.data as import('./records').ScheduleVersionData, parent = s.get('schedule', d.scheduleId);
        if (s.get(kind, input.id) || parent?.contextId !== input.contextId || parent?.data.taskId !== d.content.taskId || !s.get('user', d.changedBy) || !Number.isSafeInteger(d.sequence) || d.sequence < 1 || !['open', 'done', 'cancelled'].includes(d.state)) bad();
        const previous = d.previousId ? s.get('scheduleVersion', d.previousId) : null;
        if (d.sequence === 1 ? d.previousId !== null : previous?.data.scheduleId !== d.scheduleId || previous?.data.sequence !== d.sequence - 1) bad();
        if (s.list('scheduleVersion', input.contextId!).some(r => r.data.scheduleId === d.scheduleId && r.data.sequence === d.sequence)) throw new StoreError('CONFLICT');
    }
}
