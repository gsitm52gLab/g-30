import type { CalendarPosition, Deadline, ScheduleContent, ScheduleKind } from '@/domain/scheduling/types';
export type SelectOption = { id: string; label: string };
export type DateTimeFields = { local: string; offset: string };
export const kindLabels: Record<ScheduleKind, string> = {
  brand_reply: '브랜드 회신', submission: '자료 제출', application: '신청', review: '검토', correction: '수정',
  printing: '인쇄', shipping: '발송', arrival: '도착', publication_use: '게시·사용', external_check: '외부 확인',
};
export const certaintyLabels: Record<Deadline['certainty'], string> = {
  confirmed: '확정', requested: '요청한 일정', expected: '예상 일정', needs_confirmation: '확인 필요',
};
/** Display data only. The later controller must map freshly authorized server DTOs; these props grant no access. */
export interface SchedulePresentation {
  id: string;
  content: ScheduleContent;
  taskLabel: string;
  taskHref: string | null;
  detailHref: string | null;
  confirmationActorLabel: string;
  actionOwnerLabels: string[];
  recipientPolicyLabel: string;
  nextAction: string;
  calendar: CalendarPosition | null;
  activityLabel: string;
  reminderLabel: string;
  sourceLabel: string;
  sourceHref: string | null;
}
export interface ScheduleHistoryEntry {
  id: string;
  versionLabel: string;
  changedAtLabel: string;
  actorLabel: string;
  changeLabel: string;
  content: ScheduleContent;
  confirmationActorLabel: string;
}
