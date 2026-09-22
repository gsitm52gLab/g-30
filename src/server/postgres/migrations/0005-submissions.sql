CREATE UNIQUE INDEX IF NOT EXISTS submission_shared_draft ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb))) WHERE kind = 'submissionDraft';
CREATE UNIQUE INDEX IF NOT EXISTS submission_sequence ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb)),( NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind = 'submission';
CREATE UNIQUE INDEX IF NOT EXISTS submission_consumed_draft ON __SCHEMA__.records((NULLIF(data #> '{draftId}', 'null'::jsonb)),( NULLIF(data #> '{committedDraftRevision}', 'null'::jsonb))) WHERE kind = 'submission';
CREATE UNIQUE INDEX IF NOT EXISTS submission_upload_key ON __SCHEMA__.records((NULLIF(data #> '{submissionUpload,key}', 'null'::jsonb))) WHERE kind = 'fileVersion' AND NULLIF(data #> '{submissionUpload,key}', 'null'::jsonb) IS NOT NULL;
CREATE FUNCTION __SCHEMA__.immutable_submission_version_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind = 'submission' THEN RAISE EXCEPTION 'Immutable submission' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_submission_version BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_submission_version_fn();
CREATE FUNCTION __SCHEMA__.immutable_submission_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind = 'submission' THEN RAISE EXCEPTION 'Immutable submission' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_submission_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_submission_delete_fn();
