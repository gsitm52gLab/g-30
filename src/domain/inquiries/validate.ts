import { fail } from '@/server/auth/errors';
import { dateValue } from '../tasks/validate';
import type { CreateConversationInput, InquiryCommand, InquiryEventsQuery, InquiryListQuery, MessageInput } from './commands';
import type { ExternalWait } from './types';
/** Technical input limits, not operating policy or a monetary cap. */
export const inquiryLimits = { title: 200, body: 20000, files: 10, id: 160, reason: 2000, cursor: 512, page: 100, offset: 100000, requestBytes: 262144 } as const;
function invalid(): never { return fail('VALIDATION', 422, '문의 입력 형식 또는 범위를 확인해 주세요.'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k))) invalid();
    return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = true): string {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) invalid();
    return value;
}
export function inquiryId(value: unknown): string {
    const id = text(value, inquiryLimits.id);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) invalid();
    return id;
}
const nullableId = (value: unknown) => value === null ? null : inquiryId(value);
function revision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid();
    return value;
}
function files(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > inquiryLimits.files) invalid();
    const ids = value.map(inquiryId);
    if (new Set(ids).size !== ids.length) invalid();
    return ids;
}
function message(value: unknown): MessageInput {
    const d = record(value, ['clientMessageId', 'body', 'fileVersionIds']);
    const body = text(d.body, inquiryLimits.body, false), fileVersionIds = files(d.fileVersionIds);
    if (!body.trim() && !fileVersionIds.length) invalid();
    return { clientMessageId: inquiryId(d.clientMessageId), body, fileVersionIds };
}
function timestamp(value: unknown): string {
    const result = text(value, 60);
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(result) || Number.isNaN(Date.parse(result))) invalid();
    dateValue(result.slice(0, 10));
    return result;
}
function external(value: unknown): ExternalWait {
    const d = record(value, ['counterparty', 'sentAt', 'responsibleUserId', 'nextCheckDate', 'timezone', 'latestResult']);
    const timezone = text(d.timezone, 100);
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { invalid(); }
    return { counterparty: text(d.counterparty, 500), sentAt: d.sentAt === null ? null : timestamp(d.sentAt), responsibleUserId: inquiryId(d.responsibleUserId), nextCheckDate: dateValue(d.nextCheckDate), timezone, latestResult: text(d.latestResult, inquiryLimits.reason, false) };
}
export function parseCreateConversation(value: unknown): CreateConversationInput {
    const d = record(value, ['contextId', 'taskId', 'title', 'question', 'idempotencyKey']);
    return { contextId: inquiryId(d.contextId), taskId: nullableId(d.taskId), title: text(d.title, inquiryLimits.title), question: message(d.question), idempotencyKey: inquiryId(d.idempotencyKey) };
}
export function parseInquiryCommand(value: unknown): InquiryCommand {
    const base = record(value, ['command', 'idempotencyKey', 'expectedRevision', 'expectedQuestionRevision', 'questionId', 'content', 'kind', 'state', 'reason', 'externalWait', 'taskId', 'throughMessageId']);
    const intent = { idempotencyKey: inquiryId(base.idempotencyKey) };
    switch (base.command) {
        case 'question': {
            const d = record(base, ['command', 'idempotencyKey', 'expectedRevision', 'content']);
            return { ...intent, command: 'question', expectedRevision: revision(d.expectedRevision), content: message(d.content) };
        }
        case 'message': {
            const d = record(base, ['command', 'idempotencyKey', 'kind', 'questionId', 'content']);
            if (d.kind !== 'comment' && d.kind !== 'acknowledgement') invalid();
            return { ...intent, command: 'message', kind: d.kind, questionId: nullableId(d.questionId), content: message(d.content) };
        }
        case 'answer':
        case 'supplement': {
            const d = record(base, ['command', 'idempotencyKey', 'questionId', 'expectedQuestionRevision', 'content']);
            return { ...intent, command: base.command, questionId: inquiryId(d.questionId), expectedQuestionRevision: revision(d.expectedQuestionRevision), content: message(d.content) };
        }
        case 'internal_note': {
            const d = record(base, ['command', 'idempotencyKey', 'questionId', 'content']);
            return { ...intent, command: 'internal_note', questionId: nullableId(d.questionId), content: message(d.content) };
        }
        case 'state': {
            const d = record(base, ['command', 'idempotencyKey', 'questionId', 'expectedQuestionRevision', 'state', 'reason', 'externalWait']);
            const common = { ...intent, command: 'state' as const, questionId: inquiryId(d.questionId), expectedQuestionRevision: revision(d.expectedQuestionRevision), reason: text(d.reason, inquiryLimits.reason) };
            if (d.state === 'external_waiting') return { ...common, state: d.state, externalWait: external(d.externalWait) };
            if ((d.state !== 'gsg_waiting' && d.state !== 'brand_supplement_waiting') || d.externalWait !== null) invalid();
            return { ...common, state: d.state, externalWait: null };
        }
        case 'link_task': {
            const d = record(base, ['command', 'idempotencyKey', 'expectedRevision', 'taskId']);
            return { ...intent, command: 'link_task', expectedRevision: revision(d.expectedRevision), taskId: inquiryId(d.taskId) };
        }
        case 'read': {
            const d = record(base, ['command', 'idempotencyKey', 'throughMessageId']);
            return { ...intent, command: 'read', throughMessageId: inquiryId(d.throughMessageId) };
        }
        default: return invalid();
    }
}
function query(params: URLSearchParams, keys: string[]) {
    if ([...params.keys()].some(k => !keys.includes(k) || params.getAll(k).length !== 1)) invalid();
}
function queryNumber(value: string | null, fallback: number, min: number, max: number) {
    if (value === null) return fallback;
    if (!/^(0|[1-9]\d{0,5})$/.test(value)) invalid();
    const n = Number(value);
    if (n < min || n > max) invalid();
    return n;
}
export function parseInquiryListQuery(params: URLSearchParams): InquiryListQuery {
    query(params, ['context', 'task', 'state', 'limit', 'offset']);
    const state = params.get('state') ?? 'all';
    if (state !== 'all' && state !== 'unresolved') invalid();
    return { contextId: inquiryId(params.get('context')), taskId: params.has('task') ? inquiryId(params.get('task')) : null, state,
        limit: queryNumber(params.get('limit'), 30, 1, inquiryLimits.page), offset: queryNumber(params.get('offset'), 0, 0, inquiryLimits.offset) };
}
export function parseInquiryEventsQuery(params: URLSearchParams): InquiryEventsQuery {
    query(params, ['after', 'limit']);
    const after = params.get('after');
    if (after !== null && (after.length < 32 || after.length > inquiryLimits.cursor || !/^[A-Za-z0-9_-]+$/.test(after))) invalid();
    return { after, limit: queryNumber(params.get('limit'), 50, 1, inquiryLimits.page) };
}
