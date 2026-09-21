import type { ScheduleContent } from './types';
export type ScheduleState = 'open' | 'done' | 'cancelled';
export interface ScheduleData { taskId: string; currentVersionId: string | null; createdBy: string }
export interface ScheduleVersionData { scheduleId: string; sequence: number; previousId: string | null; content: ScheduleContent; state: ScheduleState; changedBy: string; changedAt: string; reason: string }
export interface SchedulingRecords { schedule: ScheduleData; scheduleVersion: ScheduleVersionData }
