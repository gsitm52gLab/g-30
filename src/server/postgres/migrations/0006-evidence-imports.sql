CREATE UNIQUE INDEX IF NOT EXISTS evidence_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{evidenceId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='evidenceVersion';
CREATE UNIQUE INDEX IF NOT EXISTS evidence_product_link ON __SCHEMA__.records((context_id),(NULLIF(data #> '{evidenceVersionId}', 'null'::jsonb)),(NULLIF(data #> '{productId}', 'null'::jsonb))) WHERE kind='evidenceLink';
CREATE UNIQUE INDEX IF NOT EXISTS evidence_assessment_sequence ON __SCHEMA__.records((NULLIF(data #> '{linkId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='evidenceAssessment';
CREATE FUNCTION __SCHEMA__.immutable_evidence_import_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('evidenceVersion','evidenceAssessment','importBatch') THEN RAISE EXCEPTION 'Immutable evidence/import record' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_evidence_import_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_evidence_import_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_evidence_import_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('evidenceVersion','evidenceAssessment','importBatch') THEN RAISE EXCEPTION 'Immutable evidence/import record' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_evidence_import_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_evidence_import_delete_fn();
