import type { CampaignDraft, CatalogVersionData, CampaignPublishedData, SelectionVersionData, ExternalFactData, PhysicalFactData, FollowupFactData } from './types';
export interface CampaignRecords {
 campaignCatalog: { currentVersionId:string|null };
 campaignCatalogVersion: CatalogVersionData;
 campaign: { taskId:string; draft:CampaignDraft; draftRequestId:string|null; currentVersionId:string|null; publicRevision:number; sequence:number; createdBy:string };
 campaignVersion: CampaignPublishedData & { requestId:string; privateDraft:CampaignDraft };
 campaignSelection: SelectionVersionData;
 campaignExternalFact: ExternalFactData;
 campaignPhysicalFact: PhysicalFactData;
 campaignFollowupFact: FollowupFactData;
}
