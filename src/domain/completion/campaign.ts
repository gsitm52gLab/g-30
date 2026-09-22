import type { CampaignState, MenuIdentity } from '../campaigns/types';
import type { CampaignRequestSource } from '../tasks/types';
/** Only public residual facts; no catalog originals, conditions, prices or provider payloads. */
export interface CampaignFactRef { id: string; sequence: number }
export interface CampaignMenuResidual {
    menu: MenuIdentity;
    active: boolean;
    retainedForCancellationReview: boolean;
    state: CampaignState;
    missingRequired: number;
    missingFollowup: number;
    missingReceiptObservation: number;
    reminderEligible: boolean;
    physical: {
        physicalKey: string; purpose: string; destination: string;
        requestedQuantity: string | null; unit: string;
        dispatchFacts: number; receiptFacts: number;
        receipt: 'unconfirmed' | 'explicit_receipt_recorded'; fulfillment: 'not_inferred';
        facts: CampaignFactRef[];
    }[];
    followups: {
        followupKey: string; kind: 'publication_url' | 'execution_photo' | 'performance_report' | 'custom';
        requirementKey: string; status: 'pending' | 'received'; facts: CampaignFactRef[];
    }[];
}
export interface CampaignCompletionRemainder {
    requestSource: Omit<CampaignRequestSource, 'kind' | 'actorId' | 'eventSequence'> | null;
    campaigns: {
        campaignId: string; campaignVersionId: string; contentHash: string;
        selectionVersionId: string | null;
        selections: CampaignFactRef[]; externalFacts: CampaignFactRef[];
        menus: CampaignMenuResidual[];
    }[];
}
