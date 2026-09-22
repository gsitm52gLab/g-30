import { object, str, ids, enumValue, dateValue } from '../tasks/validate';
import { fail } from '@/server/auth/errors';
import type { ExactSource, ExternalActor, ExternalActionInput, ObservedTime } from './types';
export const identifier = (v: unknown) => ids([v])[0];
export const nullableId = (v: unknown) => v === null ? null : identifier(v);
export function hash(v: unknown) { const value = str(v, 64, true); if (!/^[a-f0-9]{64}$/.test(value))
    fail('VALIDATION', 422, '자료 기준 해시를 확인해 주세요.'); return value; }
export function actor(v: unknown): ExternalActor { const a = object(v, ['kind', 'userId', 'label', 'source']); return a.kind === 'user' ? { kind: 'user', userId: identifier(a.userId) } : { kind: enumValue(a.kind, ['external']), label: str(a.label, 200, true), source: str(a.source, 1000, true) }; }
export function observed(v: unknown): ObservedTime | null {
    if (v === null)
        return null;
    const t = object(v, ['value', 'precision', 'timezone', 'source']), precision = enumValue(t.precision, ['date', 'datetime']), timezone = str(t.timezone, 100, true);
    try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    }
    catch {
        fail('VALIDATION', 422, '관측 시각의 시간대를 확인해 주세요.');
    }
    const value = precision === 'date' ? dateValue(t.value) : str(t.value, 60, true);
    if (precision === 'datetime' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))))
        fail('VALIDATION', 422, '관측 일시의 실제 시각과 오프셋을 입력해 주세요.');
    if (precision === 'datetime')
        dateValue(value.slice(0, 10));
    return { value, precision, timezone, source: str(t.source, 1000) };
}
export function source(v: unknown): ExactSource { const s = object(v, ['requestId', 'submissionId', 'submissionContentHash', 'fileVersionIds', 'productUseIds']), submissionId = nullableId(s.submissionId); return { requestId: identifier(s.requestId), submissionId, submissionContentHash: submissionId ? hash(s.submissionContentHash) : s.submissionContentHash === null ? null : fail('VALIDATION', 422, '제출과 해시를 함께 선택해 주세요.'), fileVersionIds: ids(s.fileVersionIds), productUseIds: ids(s.productUseIds) }; }
export function external(v: unknown): ExternalActionInput {
    const x = object(v, ['purpose', 'destination', 'requester', 'performer', 'source', 'observedAt', 'evidenceFileVersionIds', 'latestProgress', 'waitingExternal', 'visibility']);
    if (typeof x.waitingExternal !== 'boolean')
        fail('VALIDATION', 422, '외부 대기 여부를 확인해 주세요.');
    return { purpose: enumValue(x.purpose, ['review_request', 'application', 'final_use']), destination: str(x.destination, 1000, true), requester: actor(x.requester), performer: actor(x.performer), source: source(x.source), observedAt: observed(x.observedAt), evidenceFileVersionIds: ids(x.evidenceFileVersionIds), latestProgress: str(x.latestProgress, 4000), waitingExternal: x.waitingExternal, visibility: enumValue(x.visibility, ['public', 'internal']) };
}
export const commandKeys = ['command', 'taskId', 'idempotencyKey', 'expectedTaskRevision', 'expectedBasisHash', 'memo', 'completionId', 'reason', 'followupTaskId', 'expectedFollowupRevision', 'action'];
