/** Type-only UI boundary; services are server-only runtime imports. */
export type { CampaignDetail,CampaignList,CampaignCatalogs,CampaignSummary,CampaignPreview } from './service';
export type { SaveCatalogCommand,SaveCampaignCommand,PublishCampaignCommand,ParticipationCommand,RecordExternalFactCommand,RecordPhysicalFactCommand,RecordFollowupCommand } from '@/domain/campaigns/types';
