CREATE UNIQUE INDEX campaign_catalog_sequence ON __SCHEMA__.records((NULLIF(data #> '{catalogId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignCatalogVersion';
CREATE UNIQUE INDEX campaign_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{campaignId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignVersion';
CREATE UNIQUE INDEX campaign_selection_sequence ON __SCHEMA__.records((NULLIF(data #> '{campaignId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignSelection';
CREATE UNIQUE INDEX campaign_external_sequence ON __SCHEMA__.records((NULLIF(data #> '{campaignId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignExternalFact';
CREATE UNIQUE INDEX campaign_physical_sequence ON __SCHEMA__.records((NULLIF(data #> '{campaignId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignPhysicalFact';
CREATE UNIQUE INDEX campaign_followup_sequence ON __SCHEMA__.records((NULLIF(data #> '{campaignId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='campaignFollowupFact';
CREATE FUNCTION __SCHEMA__.campaign_immutable_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('campaignCatalogVersion','campaignVersion','campaignSelection','campaignExternalFact','campaignPhysicalFact','campaignFollowupFact') THEN RAISE EXCEPTION 'immutable campaign fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER campaign_immutable_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.campaign_immutable_update_fn();
CREATE FUNCTION __SCHEMA__.campaign_immutable_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('campaignCatalogVersion','campaignVersion','campaignSelection','campaignExternalFact','campaignPhysicalFact','campaignFollowupFact') THEN RAISE EXCEPTION 'immutable campaign fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER campaign_immutable_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.campaign_immutable_delete_fn();
