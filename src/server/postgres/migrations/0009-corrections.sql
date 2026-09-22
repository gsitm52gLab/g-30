CREATE UNIQUE INDEX correction_opinion_sequence ON __SCHEMA__.records((NULLIF(data #> '{opinionId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='correctionOpinionVersion';
CREATE UNIQUE INDEX correction_batch_sequence ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='correctionBatch';
CREATE UNIQUE INDEX correction_batch_draft ON __SCHEMA__.records((NULLIF(data #> '{draftId}', 'null'::jsonb))) WHERE kind='correctionBatch';
CREATE UNIQUE INDEX correction_item_key ON __SCHEMA__.records((NULLIF(data #> '{batchVersionId}', 'null'::jsonb)),(NULLIF(data #> '{itemKey}', 'null'::jsonb))) WHERE kind='correctionItemState';
CREATE FUNCTION __SCHEMA__.correction_immutable_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('correctionOpinionVersion','correctionBatch','correctionReflection','correctionResolution','correctionReview') THEN RAISE EXCEPTION 'immutable correction fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER correction_immutable_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.correction_immutable_update_fn();
CREATE FUNCTION __SCHEMA__.correction_immutable_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('correctionOpinionVersion','correctionBatch','correctionReflection','correctionResolution','correctionReview') THEN RAISE EXCEPTION 'immutable correction fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER correction_immutable_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.correction_immutable_delete_fn();
CREATE FUNCTION __SCHEMA__.correction_published_draft_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind='correctionDraft' AND NULLIF(OLD.data #> '{publishedVersionId}', 'null'::jsonb) IS NOT NULL THEN RAISE EXCEPTION 'immutable correction provenance' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER correction_published_draft_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.correction_published_draft_update_fn();
CREATE FUNCTION __SCHEMA__.correction_published_draft_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind='correctionDraft' AND NULLIF(OLD.data #> '{publishedVersionId}', 'null'::jsonb) IS NOT NULL THEN RAISE EXCEPTION 'immutable correction provenance' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER correction_published_draft_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.correction_published_draft_delete_fn();
