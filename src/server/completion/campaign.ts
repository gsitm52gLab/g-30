import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { CampaignCompletionRemainder, CampaignFactRef } from '@/domain/completion/campaign';
import type { SubmittedReference } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import type { Principal } from '@/server/auth/service';
import { unavailable } from '@/server/auth/errors';
import { readCampaignRemainder } from '@/server/campaigns/read';
import { versionDTO } from '@/server/campaigns/projection';
import { exactReference } from '@/server/campaigns/targets';
import * as campaignSafe from '@/server/campaigns/stored';
import { campaignRequestSource } from '@/server/tasks/campaign-request';
import { campaignRemainder } from './campaign-stored';
import * as safe from './stored';
const factRef = (r: { id: string; data: { sequence: number } }): CampaignFactRef => ({ id: safe.id(r.id), sequence: safe.count(r.data.sequence, 1) });
const kinds = ['campaignVersion', 'campaignSelection', 'campaignExternalFact', 'campaignPhysicalFact', 'campaignFollowupFact'] as const;
function version(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, campaignId: string, versionId: string, clock: Clock) {
    const root = s.get('campaign', campaignId), v = s.get('campaignVersion', versionId);
    if (!root || root.contextId !== task.contextId || root.data.taskId !== task.id || !root.data.currentVersionId || !v || v.contextId !== task.contextId || v.data.campaignId !== root.id || v.data.taskId !== task.id) unavailable();
    versionDTO(s, p, v, clock); // Exact public version + current original/reference permissions; never staff detail.
    return v;
}
function referenceDependencies(s: UnitOfWork, p: Principal, ref: SubmittedReference, clock: Clock, rows: StoredRecord[]) {
    const exact = exactReference(s, p, ref, clock);
    rows.push(exact.row, exact.request);
    const task = s.get('task', exact.reference.taskId); if (task) rows.push(task);
    for (const id of exact.reference.productUseIds) { const use = s.get('productUseSnapshot', id); if (use) rows.push(use); }
    for (const id of exact.reference.fileVersionIds) {
        const file = s.get('fileVersion', id); if (!file) unavailable(); rows.push(file);
        if (file.data.taskId) { const owner = s.get('task', file.data.taskId); if (owner) rows.push(owner); }
        if (file.data.owner?.kind === 'product') {
            const product = s.get('product', file.data.owner.productId); if (product) rows.push(product);
            const relation = s.get('contextProduct', file.data.owner.contextProductId); if (relation) rows.push(relation);
        }
    }
}
/** Reauthorizes exact captured references without recomputing historical counts or state. */
export function authorizeCampaignResidual(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, value: CampaignCompletionRemainder, clock: Clock, rows: StoredRecord[] = []) {
    if (value.requestSource) version(s, p, task, value.requestSource.campaignId, value.requestSource.campaignVersionId, clock);
    for (const c of value.campaigns) {
        const v = version(s, p, task, c.campaignId, c.campaignVersionId, clock);
        if (safe.hash(v.data.contentHash) !== c.contentHash) unavailable();
        const getFact = <K extends Exclude<typeof kinds[number], 'campaignVersion'>>(kind: K, ref: CampaignFactRef) => {
            const row = s.get(kind, ref.id);
            if (!row || row.contextId !== task.contextId || row.data.campaignId !== c.campaignId || row.data.campaignVersionId !== v.id || row.data.sequence !== ref.sequence) unavailable();
            rows.push(row); return row;
        };
        for (const ref of c.selections) getFact('campaignSelection', ref);
        if (c.selectionVersionId && !c.selections.some(r => r.id === c.selectionVersionId)) unavailable();
        for (const ref of c.externalFacts) getFact('campaignExternalFact', ref);
        for (const m of c.menus) {
            const identity = menuIdentityKey(m.menu);
            if (!v.data.menus.some(x => menuIdentityKey(campaignSafe.identity(x.identity)) === identity)) unavailable();
            for (const physical of m.physical) for (const ref of physical.facts) {
                const row = getFact('campaignPhysicalFact', ref);
                if (menuIdentityKey(campaignSafe.identity(row.data.menu)) !== identity || row.data.physicalKey !== physical.physicalKey) unavailable();
                for (const source of campaignSafe.physical(row.data).evidence) referenceDependencies(s, p, source, clock, rows);
            }
            for (const followup of m.followups) for (const ref of followup.facts) {
                const row = getFact('campaignFollowupFact', ref);
                if (menuIdentityKey(campaignSafe.identity(row.data.menu)) !== identity || row.data.followupKey !== followup.followupKey) unavailable();
                referenceDependencies(s, p, campaignSafe.submitted(row.data.source), clock, rows);
            }
        }
    }
    return value;
}
/** Actual G12 producer, synchronously in completion's UoW. No public service/nested transaction. */
export function collectCampaignResidual(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, clock: Clock, rows: StoredRecord[]) {
    const roots = s.list('campaign', task.contextId!).filter(r => r.data.taskId === task.id && r.data.currentVersionId);
    rows.push(...roots);
    for (const kind of kinds) {
        const related = s.list(kind, task.contextId!).filter(r => roots.some(root => root.id === r.data.campaignId));
        rows.push(...related); // Facts have campaignId, not taskId. Also binds a new fact without task revision changes.
        for (const r of related) {
            if (kind === 'campaignVersion') { const v = s.get('campaignVersion', r.id); if (!v || v.data.taskId !== task.id) unavailable(); }
            else {
                const fact = s.get(kind as Exclude<typeof kinds[number], 'campaignVersion'>, r.id);
                if (!fact) unavailable();
                const v = s.get('campaignVersion', fact.data.campaignVersionId);
                if (!v || v.contextId !== task.contextId || v.data.campaignId !== r.data.campaignId || v.data.taskId !== task.id) unavailable();
            }
        }
    }
    for (const r of roots) version(s, p, task, r.id, r.data.currentVersionId!, clock);
    const remainder = readCampaignRemainder(s, p, task.id, clock), current = task.data.currentRequestId ? s.get('requestVersion', task.data.currentRequestId) : null;
    if (task.data.currentRequestId && !current) unavailable();
    const source = current ? campaignRequestSource(s, current) : null;
    const value = campaignRemainder({ requestSource: source, campaigns: remainder.campaigns.map(c => {
        const v = s.get('campaignVersion', c.campaignVersionId)!;
        const facts = <K extends 'campaignSelection' | 'campaignExternalFact'>(kind: K) => s.list(kind, task.contextId!).filter(r => r.data.campaignVersionId === v.id).sort((a, b) => a.data.sequence - b.data.sequence).map(factRef);
        return { campaignId: c.campaignId, campaignVersionId: c.campaignVersionId, contentHash: v.data.contentHash, selectionVersionId: c.selectionVersionId, selections: facts('campaignSelection'), externalFacts: facts('campaignExternalFact'), menus: c.menus.map(m => ({
            menu: m.menu, active: m.active, retainedForCancellationReview: m.retainedForCancellationReview, state: m.state,
            missingRequired: m.missingRequired, missingFollowup: m.missingFollowup, missingReceiptObservation: m.missingReceiptObservation, reminderEligible: m.reminderEligible,
            physical: m.physical.map(x => ({ physicalKey: x.definition.key, purpose: x.definition.purpose, destination: x.definition.destination, requestedQuantity: x.definition.requestedQuantity, unit: x.definition.unit, dispatchFacts: x.dispatchFacts, receiptFacts: x.receiptFacts, receipt: x.receipt, fulfillment: x.fulfillment, facts: x.facts.map(f => ({ id: f.id, sequence: f.sequence })) })),
            followups: m.followups.map(x => ({ followupKey: x.definition.key, kind: x.definition.kind, requirementKey: x.definition.requirementKey, status: x.status, facts: x.facts.map(f => ({ id: f.id, sequence: f.sequence })) })),
        })) };
    }) });
    return authorizeCampaignResidual(s, p, task, value, clock, rows);
}
