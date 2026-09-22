import type { TaskData } from '@/domain/records';
import type { Deadline, RequirementType } from '@/domain/tasks/types';
import type { QuestionState } from '@/domain/inquiries/types';
export type HomeScope = 'mine' | 'context' | 'all';
export interface HomeQuery { scope?: HomeScope; context?: string }
export interface HomePerson { id: string; label: string }
export interface HomeTask {
  id: string; contextId: string; contextLabel: string; title: string; category: TaskData['category']; status: TaskData['status'];
  url: string; nextAction: string; owner: HomePerson; assignees: HomePerson[]; own: boolean;
  products: { id: string; name: string; url: string }[]; project: { id: string; title: string; url: string } | null;
  deadline: Deadline | null; requirements: { key: string; label: string; type: RequirementType; required: boolean }[];
  remaining: number | null; corrections: number; submission: { id: string; mode: 'partial' | 'full'; current: boolean; at: string } | null;
  reviewPending: boolean; handoffCheck: boolean; completedAt: string | null;
}
export interface HomeQuestion { id: string; conversationId: string; contextId: string; title: string; number: number; state: QuestionState; url: string; owner: HomePerson | null; taskId: string | null }
export interface HomeDate { key: string; contextId: string; taskId: string | null; title: string; kind: string; url: string; deadline: Deadline; owners: HomePerson[]; bucket: 'overdue' | 'today' | 'near' | 'later' | 'confirmation'; external: boolean; pending: boolean }
export interface HomeDTO {
  role: 'gsg' | 'brand'; actor: HomePerson; mode: 'mock' | 'sqlite' | 'supabase'; scope: HomeScope; selectedContext: string | null;
  contexts: { id: string; label: string }[]; tasks: HomeTask[]; questions: HomeQuestion[]; dates: HomeDate[];
  notices: { id: string; contextId: string; title: string; url: string; unread: boolean }[];
  campaigns: { id: string; taskId: string; title: string; taskTitle: string; contextId: string; url: string }[];
  counts: { tasks: number; unresolved: number; overdue: number; today: number; near: number; externalChecks: number; newSubmissions: number; handoffChecks: number; corrections: number; confirmation: number; unreadNotices: number };
  generatedAt: string; sideEffects: 'none';
}
export const homeScopeLabels: Record<HomeScope, string> = { mine: '내 업무', context: '선택 컨텍스트', all: '전체 허용 범위' };
