import { asyncMap } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { PublishedCorrectionItem } from '@/domain/corrections/types';
import { userLabel } from '@/server/submissions/access';
import { exactTarget, internalFiles } from './targets';
import * as safe from './stored';
import { correctionFileUrls } from './urls';
export async function itemHistory(s: UnitOfWork, p: Principal, b: StoredRecord<'correctionBatch'>, key: string, clock: Clock) {
    const reflections = (await asyncMap((await s.list('correctionReflection', b.contextId!)).filter(r => r.data.batchVersionId === b.id && r.data.itemKey === key), async (r) => { const t = (await exactTarget(s, p, r.data.target, clock)); return { id: r.id, itemRevision: safe.integer(r.data.itemRevision, 1), target: t.target, note: safe.text(r.data.note, 5000), recordedBy: safe.id(r.data.recordedBy), recorderLabel: (await userLabel(s, p, b.contextId!, r.data.recordedBy)), recordedAt: safe.time(r.data.recordedAt), files: t.files.map(f => ({ ...f, ...correctionFileUrls(f.id, b.id, key, f.preview, r.id) })) }; })).sort((a, b) => a.itemRevision - b.itemRevision);
    const resolutions = (await asyncMap((await s.list('correctionResolution', b.contextId!)).filter(r => r.data.batchVersionId === b.id && r.data.itemKey === key), async (r) => { const d = r.data; if (!reflections.some(x => x.id === d.reflectionId) || !['resolved', 'needs_confirmation', 'not_reflected'].includes(d.decision))
        safe.corrupt(); return { id: r.id, itemRevision: safe.integer(d.itemRevision, 1), reflectionId: safe.id(d.reflectionId), decision: d.decision, reason: safe.text(d.reason, 5000), resolvedBy: safe.id(d.resolvedBy), resolverLabel: (await userLabel(s, p, b.contextId!, d.resolvedBy)), resolvedAt: safe.time(d.resolvedAt) }; })).sort((a, b) => a.itemRevision - b.itemRevision);
    return { reflections, resolutions };
}
export function publicContent(draft: unknown) {
    const d = safe.draft(draft, true);
    return { title: d.title, summary: d.summary, items: d.items.map(i => ({ key: i.key, target: i.target, publicSource: i.publicSource, change: i.change, reason: i.reason, publicDescription: i.publicDescription, priority: i.priority, issue: i.issue } satisfies PublishedCorrectionItem)), mode: d.mode, pendingScopes: d.pendingScopes, previousBatchVersionId: d.previousBatchVersionId };
}
export function batchContent(row: StoredRecord<'correctionBatch'>) { return publicContent(row.data); }
export async function itemState(s: UnitOfWork, p: Principal, b: StoredRecord<'correctionBatch'>, itemKey: string, clock: Clock) {
    const state = (await s.list('correctionItemState', b.contextId!)).find(x => x.data.batchVersionId === b.id && x.data.itemKey === itemKey), item = batchContent(b).items.find(i => i.key === itemKey);
    if (!item)
        safe.corrupt();
    if (!state)
        return { revision: 0, status: item.issue === 'conflicting_opinions' ? 'needs_confirmation' as const : 'pending' as const, reflectionId: null, resolutionId: null, reflection: null, resolution: null };
    const r = (await s.get('correctionReflection', safe.id(state.data.reflectionId)));
    if (!r || r.contextId !== b.contextId || r.data.taskId !== b.data.taskId || r.data.batchVersionId !== b.id || r.data.itemKey !== itemKey)
        safe.corrupt();
    const reflection = { id: r.id, target: (await exactTarget(s, p, r.data.target, clock)).target, note: safe.text(r.data.note, 5000), recordedBy: safe.id(r.data.recordedBy), recorderLabel: (await userLabel(s, p, b.contextId!, r.data.recordedBy)), recordedAt: safe.time(r.data.recordedAt) };
    let resolution: null | {
        id: string;
        reflectionId: string;
        decision: 'resolved' | 'needs_confirmation' | 'not_reflected';
        reason: string;
        resolvedBy: string;
        resolverLabel: string;
        resolvedAt: string;
    } = null;
    if (state.data.resolutionId !== null) {
        const x = (await s.get('correctionResolution', safe.id(state.data.resolutionId)));
        if (!x || x.data.taskId !== b.data.taskId || x.data.batchVersionId !== b.id || x.data.itemKey !== itemKey || x.data.reflectionId !== r.id || !['resolved', 'needs_confirmation', 'not_reflected'].includes(x.data.decision))
            safe.corrupt();
        resolution = { id: x.id, reflectionId: r.id, decision: x.data.decision, reason: safe.text(x.data.reason, 5000), resolvedBy: safe.id(x.data.resolvedBy), resolverLabel: (await userLabel(s, p, b.contextId!, x.data.resolvedBy)), resolvedAt: safe.time(x.data.resolvedAt) };
    }
    return { revision: safe.integer(state.revision, 1), status: resolution?.decision ?? 'reflected' as const, reflectionId: r.id, resolutionId: resolution?.id ?? null, reflection, resolution };
}
export async function batchDTO(s: UnitOfWork, p: Principal, b: StoredRecord<'correctionBatch'>, clock: Clock) {
    const content = batchContent(b);
    return { id: safe.id(b.id), taskId: safe.id(b.data.taskId), sequence: safe.integer(b.data.sequence, 1), ...content,
        items: (await asyncMap(content.items, async (i) => { const source = (await exactTarget(s, p, i.target, clock)); return { ...i, source: { sequence: source.row.data.sequence, files: source.files.map(f => ({ ...f, ...correctionFileUrls(f.id, b.id, i.key, f.preview) })), products: source.products }, state: (await itemState(s, p, b, i.key, clock)), history: (await itemHistory(s, p, b, i.key, clock)) }; })),
        publishedBy: safe.id(b.data.publishedBy), publisherLabel: (await userLabel(s, p, b.contextId!, b.data.publishedBy)), publishedAt: safe.time(b.data.publishedAt), contentHash: safe.hash(b.data.contentHash) };
}
export async function opinionDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'correctionOpinionVersion'>, clock: Clock) {
    const d = safe.opinion(row.data);
    (await exactTarget(s, p, d.target, clock));
    return { id: row.id, opinionId: safe.id(row.data.opinionId), sequence: safe.integer(row.data.sequence, 1), previousVersionId: row.data.previousVersionId === null ? null : safe.id(row.data.previousVersionId), ...d, files: (await internalFiles(s, p, d.target.taskId, d.internalFileVersionIds, clock)), recordedBy: safe.id(row.data.recordedBy), recorderLabel: (await userLabel(s, p, row.contextId!, row.data.recordedBy)), recordedAt: safe.time(row.data.recordedAt) };
}
export async function reviewDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'correctionReview'>, clock: Clock) {
    if (row.data.previousReviewIsReferenceOnly !== true)
        safe.corrupt();
    const { idempotencyKey: _key, ...d } = safe.review(row.data);
    void _key;
    const target = (await exactTarget(s, p, d.target, clock));
    const publicIds = target.files.map(f => f.id), files = [...target.files.filter(f => d.evidenceFileVersionIds.includes(f.id)), ...(await internalFiles(s, p, d.taskId, d.evidenceFileVersionIds.filter(id => !publicIds.includes(id)), clock))];
    return { id: row.id, ...d, files, recordedBy: safe.id(row.data.recordedBy), recorderLabel: (await userLabel(s, p, row.contextId!, row.data.recordedBy)), recordedAt: safe.time(row.data.recordedAt), previousReviewIsReferenceOnly: true as const };
}
