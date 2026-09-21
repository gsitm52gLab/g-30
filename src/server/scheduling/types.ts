import type { CurrentNeed, CurrentRecipient } from '@/domain/notifications/types';
import type { Deadline, ScheduleSource } from '@/domain/scheduling/types';

/** Server-owned facts only. These are not evidence that a notification was delivered. */
export interface SourceSchedule {
    logicalKey: string;
    contextId: string;
    taskId: string | null;
    title: string;
    nextAction?: string;
    recipientPolicy?: 'task_assignees' | 'explicit_action_owner' | 'external_gsg';
    kind: string;
    source: ScheduleSource;
    sourceRevision: number;
    deadline: Deadline;
    visibility: 'public' | 'internal';
    actionUrl: string;
    unresolvedConflict: boolean;
    active: boolean;
    need: CurrentNeed | null;
    recipient: CurrentRecipient | null;
    recipientState: 'current_recipient' | 'other_recipient' | 'needs_assignment';
    reminderSupport: 'current_need' | 'source_schedule_only';
}
