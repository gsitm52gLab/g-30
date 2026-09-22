import { AuthError, fail } from '@/server/auth/errors';
import { activeMember } from '@/server/policy/policy';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { SearchDocument, SearchField, SearchKind, SearchFile } from '@/domain/search/types';
export interface SearchAccess {
    s: UnitOfWork;
    p: Principal;
    clock: Clock;
    contextId: string;
}
export function corrupt(): never { return fail('STORAGE_UNAVAILABLE', 503, '검색 원본을 확인할 수 없습니다. 잠시 후 다시 시도하거나 관리자에게 확인해 주세요.'); }
export function text(v: unknown, max = 50000): string {
    if (typeof v !== 'string' || v.length > max)
        corrupt();
    return v;
}
export function optional(v: unknown, max = 50000): string { return v === null || v === undefined ? '' : text(v, max); }
export function strings(v: unknown): string[] {
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string'))
        corrupt();
    return v.map(x => text(x));
}
export function number(v: unknown): number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
        corrupt();
    return v;
}
export function time(v: unknown): string | null {
    if (v === null || v === undefined || v === '')
        return null;
    const x = text(v, 100);
    if (!Number.isFinite(Date.parse(x)))
        corrupt();
    return x;
}
export async function visible<T>(fn: () => T | Promise<T>): Promise<T | null> {
    try {
        return (await fn());
    }
    catch (e) {
        if (e instanceof AuthError && [403, 404].includes(e.status))
            return null;
        throw e;
    }
}
export async function actor(a: SearchAccess, id: unknown) { const uid = optional(id, 160), u = uid ? (await a.s.get('user', uid)) : null; return u && (uid === a.p.user.id || u.data.status === 'active' && (await activeMember(a.s, uid, a.contextId))) ? { id: uid, label: text(u.data.name, 200) } : { id: uid || null, label: '이전 작성자' }; }
export const field = (label: string, value: unknown): SearchField => ({ label, value: optional(value) });
export function fields(v: Record<string, unknown>, mapping: Record<string, string>): SearchField[] { return Object.entries(mapping).filter(([k]) => v[k] !== undefined && v[k] !== null).map(([k, label]) => field(label, v[k])); }
export function url(path: string, contextId: string, extra: Record<string, string> = {}) { return `${path}?${new URLSearchParams({ context: contextId, ...extra })}`; }
export async function document(a: SearchAccess, kind: SearchKind, row: StoredRecord, rootId: string, title: unknown, values: SearchField[], sourceUrl: string, options: {
    at?: unknown;
    actor?: unknown;
    current?: boolean;
    version?: unknown;
    status?: unknown;
    statusPrecision?: SearchDocument['statusPrecision'];
    productIds?: unknown;
    taskId?: string | null;
    sku?: string[];
    jan?: string[];
    files?: SearchFile[];
    exactSource?: boolean;
    precision?: SearchDocument['sourcePrecision'];
} = {}): Promise<SearchDocument> {
    const safeFields = values.map(v => ({ label: text(v.label, 200), value: text(v.value) })), name = text(title, 1000), key = `${row.kind}:${row.id}`;
    return { assignees: [], key, kind, sourceKind: row.kind, sourceId: text(row.id, 160), rootId: text(rootId, 160), contextId: a.contextId, title: name, snippet: safeFields.map(x => x.value).filter(Boolean).join(' · ').slice(0, 400), status: optional(options.status, 100), statusPrecision: options.statusPrecision ?? (options.current ? 'current' : 'unavailable'), actor: (await actor(a, options.actor)), occurredAt: time(options.at), isCurrent: options.current ?? false, versionLabel: options.version === undefined ? null : `v${number(options.version)}`, sourcePrecision: options.precision ?? (options.version === undefined ? 'current_record' : 'exact_version'), historyUrl: url('/search/history', a.contextId, { kind: row.kind, id: row.id }), sourceUrl, sourceUrlPrecision: options.exactSource ? 'exact_version' : 'related_current', fields: safeFields, files: (options.files ?? []).map(f => ({ id: text(f.id, 160), name: text(f.name, 1000), downloadUrl: text(f.downloadUrl, 4000), previewUrl: f.previewUrl === null ? null : text(f.previewUrl, 4000) })), productIds: options.productIds === undefined ? [] : strings(options.productIds), taskId: options.taskId ?? null, sku: options.sku ?? [], jan: options.jan ?? [] };
}
export function publicHit(d: SearchDocument) { const { fields: unusedFields, files: unusedFiles, productIds: unusedProducts, taskId: unusedTask, sku: unusedSku, jan: unusedJan, ...hit } = d; void unusedFields; void unusedFiles; void unusedProducts; void unusedTask; void unusedSku; void unusedJan; return hit; }
