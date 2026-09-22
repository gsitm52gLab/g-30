CREATE UNIQUE INDEX IF NOT EXISTS ai_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{inputId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='aiVersion';
CREATE UNIQUE INDEX IF NOT EXISTS ai_run_attempt ON __SCHEMA__.records((NULLIF(data #> '{versionId}', 'null'::jsonb)),(NULLIF(data #> '{attempt}', 'null'::jsonb))) WHERE kind='aiRun';
CREATE UNIQUE INDEX IF NOT EXISTS ai_snapshot_run ON __SCHEMA__.records((NULLIF(data #> '{runId}', 'null'::jsonb))) WHERE kind='aiSnapshot';
CREATE FUNCTION __SCHEMA__.immutable_ai_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiAsset','aiVersion','aiSnapshot') THEN RAISE EXCEPTION 'Immutable AI input fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_ai_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_ai_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiAsset','aiVersion','aiSnapshot') THEN RAISE EXCEPTION 'Immutable AI input fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_ai_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_delete_fn();
