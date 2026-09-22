CREATE UNIQUE INDEX completion_snapshot_sequence ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='completionSnapshot';
CREATE UNIQUE INDEX completion_external_sequence ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='completionExternalAction';
CREATE UNIQUE INDEX completion_reopen_once ON __SCHEMA__.records((NULLIF(data #> '{completionId}', 'null'::jsonb))) WHERE kind='completionReopen';
CREATE FUNCTION __SCHEMA__.completion_immutable_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('completionSnapshot','completionExternalAction','completionReopen','completionFollowup') THEN RAISE EXCEPTION 'immutable completion fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER completion_immutable_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.completion_immutable_update_fn();
CREATE FUNCTION __SCHEMA__.completion_immutable_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('completionSnapshot','completionExternalAction','completionReopen','completionFollowup') THEN RAISE EXCEPTION 'immutable completion fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER completion_immutable_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.completion_immutable_delete_fn();
