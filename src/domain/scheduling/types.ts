import type { Deadline } from '@/domain/tasks/types';

export type { Deadline } from '@/domain/tasks/types';
export const scheduleKinds = ['brand_reply', 'submission', 'application', 'review', 'correction', 'printing', 'shipping', 'arrival', 'publication_use', 'external_check'] as const;
export type ScheduleKind = typeof scheduleKinds[number];
export type ScheduleVisibility = 'public' | 'internal';
/** An immutable source version and a stable logical item are deliberately separate. */
export interface ScheduleSource {
    kind: 'manual' | 'task_request' | 'task_milestone' | 'campaign' | 'inquiry_external';
    targetId: string;
    versionId: string | null;
    itemKey: string;
}
export interface SourceStatement {
    id: string;
    raw: string;
    source: string;
    version: string;
    locator: string;
}
export interface ScheduleConflict {
    id: string;
    statementIds: string[];
    state: 'unresolved' | 'resolved';
    resolution: string;
}
export interface ScheduleContent {
    taskId: string;
    title: string;
    kind: ScheduleKind;
    visibility: ScheduleVisibility;
    deadline: Deadline;
    statements: SourceStatement[];
    conflicts: ScheduleConflict[];
}
export type ReminderStage = 'two_days_before' | 'due_today' | 'overdue';
export interface CalendarPosition {
    localToday: string;
    dueDay: string | null;
    daysUntil: number | null;
    stage: ReminderStage | null;
    certainty: Deadline['certainty'];
    basis: 'confirmed' | 'tentative' | 'unconfirmed' | 'undated';
}
/** Date facts only; repository authorization and delivery are not performed here. */
export interface ScheduleTiming {
    deadline: Deadline;
    unresolvedConflict: boolean;
    active: boolean;
}
