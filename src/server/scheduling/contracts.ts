export type { ScheduleContent, ScheduleKind, Deadline, SourceStatement, ScheduleConflict } from '@/domain/scheduling/types';
export type { ScheduleState } from '@/domain/scheduling/records';
export type ScheduleList = Awaited<ReturnType<import('./service').SchedulingService['list']>>;
export type ScheduleDetail = Awaited<ReturnType<import('./service').SchedulingService['detail']>>;
