import { asyncFilter, asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { storedMenuState } from './state';
import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { PublicMenu } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { physicalFactsSummary } from '@/domain/campaigns/validate';
import { safeEvaluation, providerDTO } from '@/server/submissions/projection';
import { latestSubmission, snapshotDTO } from '@/server/submissions/read';
import { taskScope } from '@/server/policy/projection';
import { decide } from '@/server/policy/policy';
import { fileMetadata, fileUrls } from '@/server/files/service';
import { visibleFile } from '@/server/files/access';
import { productDetail } from '@/server/products/read';
import { resolveProduct } from '@/server/products/access';
import { unavailable } from '@/server/auth/errors';
import { resolveCampaign, manager, campaignTask } from './access';
import { versionDTO, versionContent, metadata, selectionDTO, catalogDTO, referenceDTO } from './projection';
import { exactReference } from './targets';
import * as safe from './stored';
export async function menuState(s: UnitOfWork, p: Principal, v: StoredRecord<'campaignVersion'>, menu: PublicMenu) { const state = (await storedMenuState(s, v, menu)); return { ...state, selection: state.selection ? (await selectionDTO(s, p, state.selection)) : null }; }
export async function menuProgress(s: UnitOfWork, p: Principal, v: StoredRecord<'campaignVersion'>, m: PublicMenu, clock: Clock) {
    const task = (await campaignTask(s, p, v.data.taskId, clock)), status = (await menuState(s, p, v, m)), latest = (await latestSubmission(s, task)), previous = latest ? (await s.get('requestVersion', latest.data.requestId)) : null;
    const request = { ...m.request, internalOriginal: '', internalMemo: '' };
    const evaluation = status.active ? safeEvaluation(request, latest?.data.answers ?? [], previous?.data.content ?? request, !!latest) : null;
    const physical = (await asyncMap(m.physical, async (definition) => { const facts = (await asyncMap((await s.list('campaignPhysicalFact', v.contextId!)).filter(r => r.data.campaignVersionId === v.id && menuIdentityKey(safe.identity(r.data.menu)) === menuIdentityKey(m.identity) && r.data.physicalKey === definition.key).sort((a, b) => a.data.sequence - b.data.sequence), async (r) => { const f = safe.physical(r.data); return { ...(await metadata(s, p, r)), ...f, performedBy: (await providerDTO(s, p, v.contextId!, f.performedBy)), evidence: (await asyncMap(f.evidence, async (x) => (await referenceDTO(s, p, x, v.id, clock)))) }; })); return { definition, facts, ...physicalFactsSummary(facts), fulfillment: 'not_inferred' as const }; }));
    const followups = (await asyncMap(m.followups, async (definition) => { const facts = (await asyncMap((await s.list('campaignFollowupFact', v.contextId!)).filter(r => r.data.campaignVersionId === v.id && menuIdentityKey(safe.identity(r.data.menu)) === menuIdentityKey(m.identity) && r.data.followupKey === definition.key).sort((a, b) => a.data.sequence - b.data.sequence), async (r) => ({ ...(await metadata(s, p, r)), source: (await referenceDTO(s, p, r.data.source, v.id, clock)), receivedBy: (await providerDTO(s, p, v.contextId!, safe.provider(r.data.receivedBy))), occurredAt: safe.occurred(r.data.occurredAt), note: safe.text(r.data.note) }))); return { definition, facts, status: facts.length ? 'received' as const : 'pending' as const }; }));
    return { menu: m.identity, ...status, evaluation, sourceSubmissionId: latest?.id ?? null, physical, followups, missingRequired: status.active ? evaluation!.missing : 0, missingFollowup: status.active ? followups.filter(f => f.status === 'pending').length : 0, missingReceiptObservation: status.active ? physical.filter(f => f.receiptFacts === 0).length : 0, reminderEligible: status.active && !['completed', 'cancelled', 'on_hold'].includes(task.data.status) };
}
export async function campaignDetail(s: UnitOfWork, p: Principal, id: string, clock: Clock, versionId?: string) {
    const { row, task } = (await resolveCampaign(s, p, id, clock)), manage = (await manager(s, p, task.id, clock)), selectedId = versionId ?? row.data.currentVersionId;
    const versions = (await s.list('campaignVersion', row.contextId!)).filter(v => v.data.campaignId === id).sort((a, b) => b.data.sequence - a.data.sequence), selected = selectedId ? versions.find(v => v.id === selectedId) : null;
    if (selectedId && !selected)
        unavailable();
    const all = (await asyncMap(versions, async (v) => (await versionDTO(s, p, v, clock)))), content = selected ? versionContent(selected) : null;
    const selections = selected ? (await asyncMap((await s.list('campaignSelection', row.contextId!)).filter(v => v.data.campaignVersionId === selected.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => (await selectionDTO(s, p, v)))) : [];
    const external = selected ? (await asyncMap((await s.list('campaignExternalFact', row.contextId!)).filter(v => v.data.campaignVersionId === selected.id).sort((a, b) => a.data.sequence - b.data.sequence), async (r) => { const f = safe.external(r.data); return { ...(await metadata(s, p, r)), menu: safe.identity(r.data.menu), axis: f.axis, value: f.value, requester: (await providerDTO(s, p, row.contextId!, f.requester)), performedBy: (await providerDTO(s, p, row.contextId!, f.performedBy)), occurredAt: f.occurredAt, note: f.note, ...manage ? { source: f.source } : {} }; })) : [];
    const submissions = (await asyncMap((await s.list('submission', row.contextId!)).filter(v => v.data.taskId === task.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => (await snapshotDTO(s, p, v, clock))));
    const draft = manage ? safe.draft(row.data.draft) : null, currentRequest = task.data.currentRequestId ? (await s.get('requestVersion', task.data.currentRequestId)) : null;
    const publicSummary = selected ? (await asyncMap(content!.menus, async (m) => (await menuProgress(s, p, selected, m, clock)))) : [];
    const providers = manage ? (await asyncFlatMap((await s.list('membership', row.contextId!)).filter(m => m.data.status === 'active'), async (m) => { const u = (await s.get('user', m.data.userId)); return u?.data.status === 'active' ? [{ id: u.id, label: u.data.name }] : []; })) : [];
    return { id: row.id, taskId: task.id, contextId: row.contextId!, taskTitle: task.data.title, taskStatus: task.data.status, requestProjection: currentRequest ? { requestId: currentRequest.id, sequence: currentRequest.data.sequence, source: (await campaignRequestSource(s, currentRequest)), taskUrl: `/tasks/${encodeURIComponent(task.id)}?context=${encodeURIComponent(task.contextId!)}` } : null, actorId: p.user.id, revision: manage ? row.revision : safe.integer(row.data.publicRevision), currentVersionId: row.data.currentVersionId, selected: all.find(v => v.id === selectedId) ?? null, versions: all, selections, external, progress: publicSummary, submissions, capabilities: { manage, respond: !!selected && selected.id === row.data.currentVersionId && (await decide(s, p, 'submission.write', taskScope(task), clock)).allowed, recordExternal: manage, recordPhysical: !!selected && (await decide(s, p, 'submission.write', taskScope(task), clock)).allowed, recordFollowup: !!selected && (await decide(s, p, 'submission.write', taskScope(task), clock)).allowed }, staff: manage ? { draft, preview: publicDraft(draft!), publishedOriginal: selected ? safe.draft(selected.data.privateDraft) : null, catalogs: (await asyncMap((await s.list('campaignCatalogVersion', row.contextId!)), async (v) => (await catalogDTO(s, p, v, clock)))), providers, sourceFiles: (await asyncFilter((await s.list('fileVersion', row.contextId!)), async (f) => f.data.taskId === task.id && (await visibleFile(s, p, f, taskScope(task), clock)))).map(f => ({ ...fileMetadata(f), ...fileUrls(f, task.id) })), products: (await asyncMap(task.data.productIds, async (pid) => (await productDetail(s, p, (await resolveProduct(s, p, row.contextId!, pid, clock)), clock)))) } : null };
}
import { publicContent as publicDraft } from './projection';
/** Synchronous caller UoW; no fake zero on a denied/corrupt relation. */
export async function readCampaignRemainder(s: UnitOfWork, p: Principal, taskId: string, clock: Clock) {
    const task = (await campaignTask(s, p, taskId, clock)), rows = (await s.list('campaign', task.contextId!)).filter(r => r.data.taskId === task.id && r.data.currentVersionId);
    const campaigns = (await asyncMap(rows, async (r) => { const v = (await s.get('campaignVersion', r.data.currentVersionId!)); if (!v)
        unavailable(); const content = versionContent(v), menus = (await asyncMap(content.menus, async (m) => (await menuProgress(s, p, v, m, clock)))); return { campaignId: r.id, campaignVersionId: v.id, selectionVersionId: menus[0]?.selection?.id ?? null, menus, activeMenus: menus.filter(m => m.active).map(m => m.menu), missingRequired: menus.reduce((n, m) => n + m.missingRequired, 0), missingFollowup: menus.reduce((n, m) => n + m.missingFollowup, 0), missingReceiptObservation: menus.reduce((n, m) => n + m.missingReceiptObservation, 0), cancellationDiscussion: menus.some(m => m.state.cancellation === 'discussion'), reminderEligible: menus.some(m => m.reminderEligible) }; }));
    return { connected: true as const, taskId, campaigns, missingRequired: campaigns.reduce((n, c) => n + c.missingRequired, 0), reminderEligible: campaigns.some(c => c.reminderEligible), notificationDeliveryConnected: true as const };
}
export async function validateFollowup(s: UnitOfWork, p: Principal, v: StoredRecord<'campaignVersion'>, m: PublicMenu, key: string, source: import('@/domain/campaigns/types').SubmittedReference, clock: Clock) {
    const definition = m.followups.find(f => f.key === key);
    if (!definition)
        unavailable();
    const r = (await exactReference(s, p, source, clock)), q = m.request.requirements.find(q => q.key === definition.requirementKey)!;
    if (!source.answer || source.answer.requirementKey !== q.key || r.answer?.type !== q.type)
        unavailable();
    const evaluation = safeEvaluation({ ...m.request, internalOriginal: '', internalMemo: '' }, r.snapshot.content.answers, r.request.data.content), item = evaluation.items.find(i => i.requirementKey === q.key && i.productId === source.answer!.productId);
    if (!item || item.status !== 'received' || ['execution_photo', 'performance_report'].includes(definition.kind) && !source.fileVersionIds.length)
        unavailable();
    return r;
}
