import { asyncFilter, asyncMap } from "@/domain/async-collections";
import { authorizeCampaignResidual } from './campaign';
import { authorizeAiResidual } from '@/server/ai-review/completion';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { inquiryScope } from '@/server/inquiries/access';
import { readProductUse } from '@/server/products/capture';
import { resolveProduct } from '@/server/products/access';
import { userLabel } from '@/server/submissions/access';
import { exactTarget } from '@/server/corrections/targets';
import { batchContent } from '@/server/corrections/projection';
import { unavailable } from '@/server/auth/errors';
import { completionTask } from './access';
import { available } from './collect';
import { actorDTO, authorizedFile, exactSource } from './sources';
import * as safe from './stored';
async function visibleConversation(s: UnitOfWork, p: Principal, id: unknown, clock: Clock) {
    if (typeof id !== 'string')
        return false;
    const c = (await s.get('conversation', id));
    return !!c && c.data.phase === 'active' && (p.user.data.role === 'gsg' || c.data.initiatorId === p.user.id) && (await decide(s, p, 'inquiry.read', inquiryScope(c), clock)).allowed;
}
export async function projectBasis(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, input: unknown, clock: Clock) {
    let raw = safe.object(input);
    // Do not interpret hidden participants' question bodies or expose their counts.
    if (p.user.data.role !== 'gsg') {
        const inquiries = safe.object(raw.inquiries), visible = inquiries.state === 'available' ? (await asyncFilter(safe.array(safe.object(inquiries.value).items), async (v) => (await visibleConversation(s, p, safe.object(v).conversationId, clock)))) : [];
        raw = { ...raw, ai: { connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' }, inquiries: inquiries.state === 'available' ? { connected: true, state: 'available', value: { items: visible, unresolved: visible.filter(v => safe.object(v).state !== 'resolved').length, externalWaiting: visible.filter(v => safe.object(v).state === 'external_waiting').length } } : { connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' }, externalActions: safe.array(raw.externalActions).filter(v => safe.object(v).visibility === 'public') };
    }
    const b = safe.basis(raw);
    const inquiries = b.inquiries.state === 'available' ? { ...b.inquiries, value: { items: (await asyncFilter(b.inquiries.value.items, async (i) => (await visibleConversation(s, p, i.conversationId, clock)))), unresolved: 0, externalWaiting: 0 } } : b.inquiries;
    if (inquiries.state === 'available') {
        inquiries.value.unresolved = inquiries.value.items.filter(x => x.state !== 'resolved').length;
        inquiries.value.externalWaiting = inquiries.value.items.filter(x => x.state === 'external_waiting').length;
    }
    const corrections = b.corrections.state === 'available' ? (await available(async () => {
        if (b.corrections.state !== 'available')
            safe.corrupt();
        const items = (await asyncMap(b.corrections.value.items, async (i) => {
            const batch = (await s.get('correctionBatch', i.batchVersionId));
            if (!batch || batch.data.taskId !== task.id)
                unavailable();
            const item = batchContent(batch).items.find(x => x.key === i.itemKey);
            if (!item)
                unavailable();
            (await exactTarget(s, p, item.target, clock));
            return i;
        }));
        return { items, unresolved: items.filter(i => i.status !== 'resolved').length, pendingScopes: b.corrections.value.pendingScopes };
    })) : b.corrections;
    const currentProducts = b.currentProducts.state === 'available' ? (await available(async () => b.currentProducts.state === 'available' ? (await asyncMap(b.currentProducts.value, async (x) => { (await resolveProduct(s, p, task.contextId!, x.productId, clock)); return x; })) : [])) : b.currentProducts;
    const submissionSource = (await available(async () => {
        if (!b.latestSubmission)
            return null;
        const sub = (await s.get('submission', b.latestSubmission.id));
        if (!sub || sub.data.taskId !== task.id || sub.data.contentHash !== b.latestSubmission.contentHash)
            unavailable();
        for (const id of b.latestSubmission.fileVersionIds)
            (await authorizedFile(s, p, task, id, clock, true));
        if (b.latestSubmission.products.state === 'available')
            for (const use of b.latestSubmission.products.value)
                (await readProductUse(s, p, use.id, clock));
        return b.latestSubmission;
    }));
    const campaign = b.campaign.state === 'available' ? (await available(async () => { if (b.campaign.state !== 'available')
        safe.corrupt(); return (await authorizeCampaignResidual(s, p, task, b.campaign.value, clock)); })) : b.campaign;
    const ai = b.ai.state === 'available' ? (await available(async () => { if (b.ai.state !== 'available')
        safe.corrupt(); return (await authorizeAiResidual(s, p, task, b.ai.value, clock)); })) : b.ai;
    const externalActions = (await asyncFilter(b.externalActions, async (x) => { const row = (await s.get('completionExternalAction', x.id)); return !!row && row.data.taskId === task.id && (p.user.data.role === 'gsg' || row.data.visibility === 'public') && (await available(async () => (await externalDTO(s, p, row, clock)))).state === 'available'; }));
    return { ...b, latestSubmission: submissionSource.state === 'available' ? submissionSource.value : null, submittedSourceState: submissionSource.state, inquiries, corrections, currentProducts, externalActions, campaign, ai, scope: p.user.data.role === 'gsg' ? 'current_gsg_access' as const : 'current_brand_access' as const };
}
export async function snapshotDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'completionSnapshot'>, clock: Clock) {
    const task = (await completionTask(s, p, row.data.taskId, clock)), d = row.data;
    return { id: safe.id(row.id), taskId: task.id, sequence: safe.count(d.sequence, 1), previousCompletionId: safe.nullableId(d.previousCompletionId), memo: safe.text(d.memo), completedByLabel: safe.text((await userLabel(s, p, task.contextId!, safe.id(d.completedBy))), 200), completedAt: safe.time(d.completedAt), statusBefore: safe.choice(d.statusBefore, ['draft', 'requested', 'in_progress', 'partial', 'submitted', 'completed', 'on_hold', 'cancelled']), basis: (await projectBasis(s, p, task, d.basis, clock)), ...(p.user.data.role === 'gsg' ? { basisHash: safe.hash(d.basisHash), taskRevision: safe.count(d.taskRevision, 1) } : {}) };
}
export async function externalDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'completionExternalAction'>, clock: Clock) {
    const task = (await completionTask(s, p, row.data.taskId, clock));
    if (p.user.data.role !== 'gsg' && row.data.visibility !== 'public')
        unavailable();
    const x = safe.external(row.data), exact = (await exactSource(s, p, task, x.source, clock)), files = (await asyncMap(x.evidenceFileVersionIds, async (id) => (await authorizedFile(s, p, task, id, clock, x.visibility === 'public'))));
    const urls = (id: string) => ({ downloadUrl: `/api/completion/files/${id}?externalActionId=${row.id}&mode=download`, originalUrl: `/api/completion/files/${id}?externalActionId=${row.id}&mode=original`, previewUrl: null });
    return { id: safe.id(row.id), taskId: task.id, sequence: safe.count(row.data.sequence, 1), purpose: x.purpose, destination: x.destination, requester: (await actorDTO(s, p, task, x.requester)), performer: (await actorDTO(s, p, task, x.performer)), source: { ...exact.source, requestSequence: exact.requestSequence, submissionSequence: exact.submissionSequence, files: exact.files.map(f => ({ ...f, ...urls(f.id) })), products: exact.products }, observedAt: x.observedAt, evidenceFiles: files.map(f => ({ ...f, ...urls(f.id) })), latestProgress: x.latestProgress, waitingExternal: x.waitingExternal, visibility: x.visibility, recordedByLabel: safe.text((await userLabel(s, p, task.contextId!, safe.id(row.data.recordedBy))), 200), recordedAt: safe.time(row.data.recordedAt), effect: 'record_only' as const };
}
export async function reopenDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'completionReopen'>, clock: Clock) { const task = (await completionTask(s, p, row.data.taskId, clock)); return { id: safe.id(row.id), completionId: safe.id(row.data.completionId), reason: safe.text(row.data.reason, 2000), resumedStatus: safe.choice(row.data.resumedStatus, ['requested', 'in_progress', 'partial', 'submitted']), reopenedByLabel: safe.text((await userLabel(s, p, task.contextId!, safe.id(row.data.reopenedBy))), 200), reopenedAt: safe.time(row.data.reopenedAt) }; }
export async function followupDTO(s: UnitOfWork, p: Principal, row: StoredRecord<'completionFollowup'>, clock: Clock) {
    const task = (await completionTask(s, p, row.data.taskId, clock)), other = (await s.get('task', row.data.followupTaskId));
    if (!other || other.contextId !== task.contextId || !(await decide(s, p, 'task.read', taskScope(other), clock)).allowed)
        return null;
    return { id: safe.id(row.id), completionId: safe.id(row.data.completionId), taskId: other.id, title: safe.text(other.data.title, 200), reason: safe.text(row.data.reason, 2000), linkedByLabel: safe.text((await userLabel(s, p, task.contextId!, safe.id(row.data.linkedBy))), 200), linkedAt: safe.time(row.data.linkedAt) };
}
