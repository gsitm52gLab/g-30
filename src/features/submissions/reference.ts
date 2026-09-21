import type { SubmissionSnapshot } from '@/server/submissions/contracts';

export const referenceKeys = ['requestId', 'submissionId', 'requirementKey', 'productId'] as const;
export interface SubmissionReference { taskId: string; contextId: string; requestId: string; submissionId: string; requirementKey: string; productId: string | null }
export type ReferenceSelection = { kind: 'none' } | { kind: 'invalid' } | { kind: 'reference'; value: SubmissionReference };
type Query = Pick<URLSearchParams, 'has' | 'getAll'>;
const safe = (v: string) => v.length <= 2000 && v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v);
/** Absence is ordinary navigation; any supplied reference requires the entire exact address. */
export function parseSubmissionReference(taskId: string, query: Query): ReferenceSelection {
    if (!referenceKeys.some(k => query.has(k))) return { kind: 'none' };
    const keys = ['context', ...referenceKeys];
    if (!safe(taskId) || keys.some(k => query.getAll(k).length !== 1)) return { kind: 'invalid' };
    const value = (k: string) => query.getAll(k)[0];
    if (keys.some(k => k !== 'productId' && !safe(value(k))) || (value('productId') !== '' && !safe(value('productId')))) return { kind: 'invalid' };
    return { kind: 'reference', value: { taskId, contextId: value('context'), requestId: value('requestId'), submissionId: value('submissionId'), requirementKey: value('requirementKey'), productId: value('productId') || null } };
}
export function referenceHref(r: SubmissionReference) {
    const query = new URLSearchParams({ context: r.contextId, requestId: r.requestId, submissionId: r.submissionId, requirementKey: r.requirementKey, productId: r.productId ?? '' });
    return `/tasks/${encodeURIComponent(r.taskId)}?${query}`;
}
/** A successful GET alone is insufficient: every relationship and typed address must match. */
export function matchesSubmissionReference(v: SubmissionSnapshot, r: SubmissionReference) {
    if (v.id !== r.submissionId || v.taskId !== r.taskId || v.contextId !== r.contextId || v.requestId !== r.requestId || v.request.id !== r.requestId) return false;
    const qs = v.request.content.requirements.filter(q => q.key === r.requirementKey);
    const answers = v.answers.filter(a => a.requirementKey === r.requirementKey && a.productId === r.productId);
    if (qs.length !== 1 || answers.length !== 1) return false;
    const q = qs[0], a = answers[0];
    return a.requestId === r.requestId && a.type === q.type && (r.productId === null ? q.productIds.length === 0 : q.productIds.includes(r.productId) && v.products.some(p => p.productId === r.productId));
}
