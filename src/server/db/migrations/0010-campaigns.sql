CREATE UNIQUE INDEX campaign_catalog_sequence ON records(json_extract(data,'$.catalogId'),json_extract(data,'$.sequence')) WHERE kind='campaignCatalogVersion';
CREATE UNIQUE INDEX campaign_version_sequence ON records(json_extract(data,'$.campaignId'),json_extract(data,'$.sequence')) WHERE kind='campaignVersion';
CREATE UNIQUE INDEX campaign_selection_sequence ON records(json_extract(data,'$.campaignId'),json_extract(data,'$.sequence')) WHERE kind='campaignSelection';
CREATE UNIQUE INDEX campaign_external_sequence ON records(json_extract(data,'$.campaignId'),json_extract(data,'$.sequence')) WHERE kind='campaignExternalFact';
CREATE UNIQUE INDEX campaign_physical_sequence ON records(json_extract(data,'$.campaignId'),json_extract(data,'$.sequence')) WHERE kind='campaignPhysicalFact';
CREATE UNIQUE INDEX campaign_followup_sequence ON records(json_extract(data,'$.campaignId'),json_extract(data,'$.sequence')) WHERE kind='campaignFollowupFact';
CREATE TRIGGER campaign_immutable_update BEFORE UPDATE ON records WHEN OLD.kind IN ('campaignCatalogVersion','campaignVersion','campaignSelection','campaignExternalFact','campaignPhysicalFact','campaignFollowupFact') BEGIN SELECT RAISE(ABORT,'immutable campaign fact'); END;
CREATE TRIGGER campaign_immutable_delete BEFORE DELETE ON records WHEN OLD.kind IN ('campaignCatalogVersion','campaignVersion','campaignSelection','campaignExternalFact','campaignPhysicalFact','campaignFollowupFact') BEGIN SELECT RAISE(ABORT,'immutable campaign fact'); END;
