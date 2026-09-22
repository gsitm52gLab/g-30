import type { CampaignCompletionRemainder, CampaignMenuResidual } from '@/domain/completion/campaign';
import * as safe from './stored';
const strings = (v: unknown) => safe.array(v).map(x => safe.text(x, 2000));
const refs = (v: unknown) => safe.array(v).map(v => { const x = safe.object(v); return { id: safe.id(x.id), sequence: safe.count(x.sequence, 1) }; });
function menu(v: unknown): CampaignMenuResidual {
    const x = safe.object(v), m = safe.object(x.menu), s = safe.object(x.state);
    return {
        menu: { catalogVersionId: safe.id(m.catalogVersionId), menuKey: safe.id(m.menuKey), menuName: safe.text(m.menuName, 300), menuNumber: safe.text(m.menuNumber, 100) },
        active: safe.bool(x.active), retainedForCancellationReview: safe.bool(x.retainedForCancellationReview),
        state: {
            response: safe.choice(s.response, ['pending', 'participate', 'decline', 'discuss']),
            application: safe.choice(s.application, ['not_applied', 'applied', 'withdrawal_requested', 'cancelled']),
            selection: safe.choice(s.selection, ['pending', 'selected', 'not_selected']),
            preparation: safe.choice(s.preparation, ['not_started', 'preparing', 'ready']),
            execution: safe.choice(s.execution, ['not_started', 'in_progress', 'finished']),
            resultReceipt: safe.choice(s.resultReceipt, ['not_received', 'partial', 'received']),
            cancellation: safe.choice(s.cancellation, ['none', 'discussion', 'cancelled']),
        },
        missingRequired: safe.count(x.missingRequired), missingFollowup: safe.count(x.missingFollowup),
        missingReceiptObservation: safe.count(x.missingReceiptObservation), reminderEligible: safe.bool(x.reminderEligible),
        physical: safe.array(x.physical).map(v => {
            const a = safe.object(v), quantity = a.requestedQuantity === null ? null : safe.text(a.requestedQuantity, 200);
            if (quantity !== null && !/^\d+(?:\.\d+)?$/.test(quantity)) safe.corrupt();
            return { physicalKey: safe.id(a.physicalKey), purpose: safe.text(a.purpose, 1000), destination: safe.text(a.destination, 2000), requestedQuantity: quantity, unit: safe.text(a.unit, 100), dispatchFacts: safe.count(a.dispatchFacts), receiptFacts: safe.count(a.receiptFacts), receipt: safe.choice(a.receipt, ['unconfirmed', 'explicit_receipt_recorded']), fulfillment: safe.choice(a.fulfillment, ['not_inferred']), facts: refs(a.facts) };
        }),
        followups: safe.array(x.followups).map(v => { const a = safe.object(v); return { followupKey: safe.id(a.followupKey), kind: safe.choice(a.kind, ['publication_url', 'execution_photo', 'performance_report', 'custom']), requirementKey: safe.id(a.requirementKey), status: safe.choice(a.status, ['pending', 'received']), facts: refs(a.facts) }; }),
    };
}
export function campaignRemainder(v: unknown): CampaignCompletionRemainder {
    const x = safe.object(v), r = x.requestSource === null ? null : safe.object(x.requestSource);
    return {
        requestSource: r ? { campaignId: safe.id(r.campaignId), campaignVersionId: safe.id(r.campaignVersionId), selectionVersionId: safe.nullableId(r.selectionVersionId), sourceFactId: safe.nullableId(r.sourceFactId), originalRequestId: safe.id(r.originalRequestId), activeMenuKeys: strings(r.activeMenuKeys), retainedCancellationMenuKeys: strings(r.retainedCancellationMenuKeys), retainedRequirementKeys: strings(r.retainedRequirementKeys), materialProductIds: safe.array(r.materialProductIds).map(safe.id), noMaterials: safe.bool(r.noMaterials) } : null,
        campaigns: safe.array(x.campaigns).map(v => { const c = safe.object(v); return { campaignId: safe.id(c.campaignId), campaignVersionId: safe.id(c.campaignVersionId), contentHash: safe.hash(c.contentHash), selectionVersionId: safe.nullableId(c.selectionVersionId), selections: refs(c.selections), externalFacts: refs(c.externalFacts), menus: safe.array(c.menus).map(menu) }; }),
    };
}
