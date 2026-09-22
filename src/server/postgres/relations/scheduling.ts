// Explicit asynchronous counterpart of src/domain/scheduling/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
export async function schedulingRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'schedule' && kind !== 'scheduleVersion')
        return;
    const bad = () => { throw new StoreError('INVALID_RECORD'); };
    if (!input.contextId || !(await s.get('context', input.contextId)))
        bad();
    if (kind === 'schedule') {
        const d = input.data as import("@/domain/scheduling/records").ScheduleData, old = (await s.get('schedule', input.id));
        if ((await s.get('task', d.taskId))?.contextId !== input.contextId || !(await s.get('user', d.createdBy)) || old && (old.data.taskId !== d.taskId || old.data.createdBy !== d.createdBy) || d.currentVersionId && (await s.get('scheduleVersion', d.currentVersionId))?.data.scheduleId !== input.id)
            bad();
    }
    else {
        const d = input.data as import("@/domain/scheduling/records").ScheduleVersionData, parent = (await s.get('schedule', d.scheduleId));
        if ((await s.get(kind, input.id)) || parent?.contextId !== input.contextId || parent?.data.taskId !== d.content.taskId || !(await s.get('user', d.changedBy)) || !Number.isSafeInteger(d.sequence) || d.sequence < 1 || !['open', 'done', 'cancelled'].includes(d.state))
            bad();
        const previous = d.previousId ? (await s.get('scheduleVersion', d.previousId)) : null;
        if (d.sequence === 1 ? d.previousId !== null : previous?.data.scheduleId !== d.scheduleId || previous?.data.sequence !== d.sequence - 1)
            bad();
        if ((await s.list('scheduleVersion', input.contextId!)).some(r => r.data.scheduleId === d.scheduleId && r.data.sequence === d.sequence))
            throw new StoreError('CONFLICT');
    }
}
