import { fail } from '@/server/auth/errors';
import { requirementTypes, type Deadline } from '@/domain/tasks/types';
import type { HomeDTO, HomePerson, HomeTask, HomeQuestion, HomeDate } from './contracts';

type Rule = (value: unknown) => boolean;
type Shape<T> = { [K in keyof T]-?: Rule };
const text: Rule = v => typeof v === 'string';
const bool: Rule = v => typeof v === 'boolean';
const count: Rule = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const oneOf = (...allowed: readonly string[]): Rule => v => typeof v === 'string' && allowed.includes(v);
const nullable = (rule: Rule): Rule => v => v === null || rule(v);
const list = (rule: Rule): Rule => v => Array.isArray(v) && v.every(rule);
const object = (shape: Record<string, Rule>): Rule => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const record = v as Record<string, unknown>;
  return Object.keys(record).length === Object.keys(shape).length
    && Object.entries(shape).every(([key, rule]) => Object.hasOwn(record, key) && rule(record[key]));
};
const person = object({ id: text, label: text } satisfies Shape<HomePerson>);
const deadline = object({
  value: nullable(text), precision: oneOf('date', 'datetime'), timezone: text,
  certainty: oneOf('confirmed', 'requested', 'expected', 'needs_confirmation'),
  source: text, sourceVersion: text, responsibleUserId: text, raw: text,
} satisfies Shape<Deadline>);
const task = object({
  id: text, contextId: text, contextLabel: text, title: text,
  category: oneOf('onboarding', 'spot'), status: oneOf('draft', 'requested', 'in_progress', 'partial', 'submitted', 'completed', 'on_hold', 'cancelled'),
  url: text, nextAction: text, owner: person, assignees: list(person), own: bool,
  products: list(object({ id: text, name: text, url: text })),
  project: nullable(object({ id: text, title: text, url: text })), deadline: nullable(deadline),
  requirements: list(object({ key: text, label: text, type: oneOf(...requirementTypes), required: bool })),
  remaining: nullable(count), corrections: count,
  submission: nullable(object({ id: text, mode: oneOf('partial', 'full'), current: bool, at: text })),
  reviewPending: bool, handoffCheck: bool, completedAt: nullable(text),
} satisfies Shape<HomeTask>);
const question = object({
  id: text, conversationId: text, contextId: text, title: text, number: count,
  state: oneOf('gsg_waiting', 'brand_supplement_waiting', 'external_waiting', 'resolved'),
  url: text, owner: nullable(person), taskId: nullable(text),
} satisfies Shape<HomeQuestion>);
const date = object({
  key: text, contextId: text, taskId: nullable(text), title: text, kind: text, url: text,
  deadline, owners: list(person), bucket: oneOf('overdue', 'today', 'near', 'later', 'confirmation'),
  external: bool, pending: bool,
} satisfies Shape<HomeDate>);
const home = object({
  role: oneOf('gsg', 'brand'), actor: person, mode: oneOf('mock', 'sqlite', 'supabase'),
  scope: oneOf('mine', 'context', 'all'), selectedContext: nullable(text),
  contexts: list(object({ id: text, label: text })), tasks: list(task), questions: list(question), dates: list(date),
  notices: list(object({ id: text, contextId: text, title: text, url: text, unread: bool })),
  campaigns: list(object({ id: text, taskId: text, title: text, taskTitle: text, contextId: text, url: text })),
  counts: object({ tasks: count, unresolved: count, overdue: count, today: count, near: count,
    externalChecks: count, newSubmissions: count, handoffChecks: count, corrections: count, confirmation: count, unreadNotices: count }),
  generatedAt: text, sideEffects: oneOf('none'),
} satisfies Shape<HomeDTO>);
const invalid = (): never => fail('STORAGE_UNAVAILABLE', 503, '홈 원본 정보를 확인할 수 없습니다. 다시 시도해 주세요.');

/** Stored JSON types are untrusted even after ACL. Never coerce nested values into a public label. */
export function homeText(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  return value;
}
/** Check the explicit public DTO, after authorization and before sorting/serialization.
 * A malformed known field fails the whole read; it is not omitted or converted to an empty count.
 * No stored value, private field name, or record identifier is included in the error.
 */
export function assertHomeProjection(value: HomeDTO): void {
  if (!home(value)) invalid();
}
