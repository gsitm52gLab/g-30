import type { Deadline, RequestContent } from '../tasks/types';
import type { AnswerAddress, DateInput, Provider } from '../submissions/types';
/** External retailer marketing menu, never a platform Product record. */
export interface MenuIdentity { catalogVersionId: string; menuKey: string; menuName: string; menuNumber: string }
export const menuIdentityKey = (menu: MenuIdentity) => JSON.stringify([menu.catalogVersionId, menu.menuKey]);
export interface SourceText {
    source: string; sourceVersion: string; locator: string; language: string;
    originalText: string; translatedText: string; fileVersionIds: string[];
}
export interface CatalogDraft { title: string; versionLabel: string; source: SourceText }
export interface ServerVersion { readonly sequence: number; readonly previousId: string | null; readonly recordedBy: string; readonly recordedAt: string }
export interface CatalogVersionData extends CatalogDraft, ServerVersion { readonly catalogId: string; readonly contextId: string }
export type StatementField = 'menu_number' | 'menu_name' | 'date' | 'price' | 'discount' | 'points' | 'past_performance';
export interface SourceStatement { id: string; field: StatementField; rawValue: string; source: SourceText }
export interface SourceConflict {
    field: StatementField; statementIds: string[]; state: 'needs_confirmation' | 'confirmed'; resolution: string;
}
export interface MenuConditions {
    state: 'needs_confirmation' | 'confirmed'; sourceStatementIds: string[]; publicExplanation: string;
    cost: { amount: string | null; currency: string | null; taxIncluded: 'unknown' | 'yes' | 'no' };
    discount: string; points: string; cancellationTerms: string;
    schedules: { key: string; kind: 'application' | 'delivery' | 'publication'; deadline: Deadline }[];
}
/** Existing exact product versions, optionally tied to an already-created G05 ProductUse. */
export interface CampaignProduct {
    productId: string; productVersionId: string; contextProductVersionId: string;
    productUseId: string | null; sampleVariant: string;
}
export interface PhysicalRequirement {
    key: string; destination: string; purpose: string; product: CampaignProduct;
    requestedQuantity: string | null; unit: string; plannedShip: Deadline; plannedArrival: Deadline;
}
export interface FollowupRequirement {
    key: string; kind: 'publication_url' | 'execution_photo' | 'performance_report' | 'custom';
    requirementKey: string; deadline: Deadline;
}
export interface MenuDraft {
    identity: MenuIdentity; sourceStatements: SourceStatement[]; conflicts: SourceConflict[];
    conditions: MenuConditions; templateVersionId: string | null; request: RequestContent;
    products: CampaignProduct[]; physical: PhysicalRequirement[]; followups: FollowupRequirement[];
}
export interface CampaignDraft { title: string; menus: MenuDraft[] }
/** Staff-only draft and brand DTO are deliberately different. Runtime projector remains server work. */
export interface PublicMenu {
    identity: MenuIdentity; conditions: Omit<MenuConditions, 'sourceStatementIds'>;
    templateVersionId: string | null; request: Omit<RequestContent, 'internalOriginal' | 'internalMemo'>;
    products: CampaignProduct[]; physical: PhysicalRequirement[]; followups: FollowupRequirement[];
    confirmationIssues: Pick<SourceConflict, 'field' | 'state'>[];
}
export interface CampaignPublishedData extends ServerVersion {
    readonly campaignId: string; readonly contextId: string; readonly taskId: string;
    readonly title: string; readonly menus: readonly PublicMenu[]; readonly contentHash: string;
}
export interface CampaignState {
    response: 'pending' | 'participate' | 'decline' | 'discuss';
    application: 'not_applied' | 'applied' | 'withdrawal_requested' | 'cancelled';
    selection: 'pending' | 'selected' | 'not_selected';
    preparation: 'not_started' | 'preparing' | 'ready';
    execution: 'not_started' | 'in_progress' | 'finished';
    resultReceipt: 'not_received' | 'partial' | 'received';
    cancellation: 'none' | 'discussion' | 'cancelled';
}
export interface CommandIdentity { contextId: string; taskId: string; campaignId: string; expectedRevision: number; idempotencyKey: string }
export interface SaveCatalogCommand { contextId: string; catalogId: string | null; expectedRevision: number; idempotencyKey: string; draft: CatalogDraft }
export interface SaveCampaignCommand { contextId: string; taskId: string; campaignId: string | null; expectedRevision: number; idempotencyKey: string; draft: CampaignDraft }
export type PublishCampaignCommand = CommandIdentity;
export interface ParticipationCommand extends CommandIdentity {
    campaignVersionId: string; response: Exclude<CampaignState['response'], 'pending'>;
    selectedMenus: MenuIdentity[]; providedBy: Provider; note: string;
}
export interface SelectionVersionData extends ServerVersion {
    readonly campaignId: string; readonly campaignVersionId: string;
    readonly response: ParticipationCommand['response']; readonly selectedMenus: readonly MenuIdentity[];
    readonly providedBy: Provider; readonly note: string;
}
export type ExternalAxis = Exclude<keyof CampaignState, 'response'>;
export type ExternalChange = { [K in ExternalAxis]: { axis: K; value: CampaignState[K] } }[ExternalAxis];
export type ExternalFactInput = ExternalChange & { requester: Provider; performedBy: Provider; occurredAt: DateInput | null; source: SourceText; note: string };
export interface RecordExternalFactCommand extends CommandIdentity { campaignVersionId: string; menu: MenuIdentity; fact: ExternalFactInput }
export type ExternalFactData = ExternalFactInput & ServerVersion & { readonly campaignId: string; readonly campaignVersionId: string; readonly menu: MenuIdentity };
/** Actual exact G05 reference, not a current product capture or proof that a shipment occurred. */
export interface SubmittedReference {
    taskId: string; requestId: string; submissionId: string; contentHash: string;
    answer: Pick<AnswerAddress, 'requirementKey' | 'productId'> | null;
    fileVersionIds: string[]; productUseIds: string[];
}
export interface PhysicalProvenance { performedBy: Provider; occurredAt: DateInput | null; evidence: SubmittedReference[]; note: string }
export type PhysicalFactInput = PhysicalProvenance & (
    | { kind: 'tracking'; carrier: string; trackingNumber: string; trackingUrl: string | null }
    | { kind: 'dispatch'; quantity: string; unit: string; carrier: string; trackingNumber: string }
    | { kind: 'receipt'; quantity: string; unit: string; dispatchFactIds: string[] }
);
export interface RecordPhysicalFactCommand extends CommandIdentity {
    campaignVersionId: string; menu: MenuIdentity; physicalKey: string; fact: PhysicalFactInput;
}
export type PhysicalFactData = PhysicalFactInput & ServerVersion & { readonly campaignId: string; readonly campaignVersionId: string; readonly menu: MenuIdentity; readonly physicalKey: string };
export interface RecordFollowupCommand extends CommandIdentity {
    campaignVersionId: string; menu: MenuIdentity; followupKey: string;
    source: SubmittedReference; receivedBy: Provider; occurredAt: DateInput | null; note: string;
}
export type FollowupFactData = Omit<RecordFollowupCommand, 'contextId' | 'taskId' | 'expectedRevision' | 'idempotencyKey'> & ServerVersion;
export interface ActiveMenuObligations {
    menu: MenuIdentity; requirementKeys: string[]; physicalKeys: string[]; followupKeys: string[];
    deadlines: Deadline[];
}
/** Consumers distinguish unavailable from an actual empty list; no canComplete approval gate. */
export type CampaignRemainder = { connected: false; reason: 'not_connected' | 'unavailable' } | {
    connected: true; campaignVersionId: string; selectionVersionId: string;
    active: ActiveMenuObligations[]; cancellationDiscussion: boolean;
};
export interface CampaignEvent {
    eventType: 'CAMPAIGN_PUBLISHED' | 'CAMPAIGN_SELECTION_RECORDED' | 'CAMPAIGN_FACT_RECORDED';
    targetId: string; sourceVersionId: string; actorId: string; at: string;
}
