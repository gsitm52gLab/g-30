CREATE UNIQUE INDEX IF NOT EXISTS task_receipt_key ON __SCHEMA__.records((NULLIF(data #> '{key}', 'null'::jsonb))) WHERE kind = 'commandReceipt';
CREATE UNIQUE INDEX IF NOT EXISTS task_request_sequence ON __SCHEMA__.records((NULLIF(data #> '{taskId}', 'null'::jsonb)),( NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind = 'requestVersion';
CREATE UNIQUE INDEX IF NOT EXISTS template_sequence ON __SCHEMA__.records((COALESCE(context_id, '')),( NULLIF(data #> '{templateId}', 'null'::jsonb)),( NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind = 'templateVersion';
CREATE FUNCTION __SCHEMA__.immutable_task_versions_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('requestVersion','templateVersion','taskActivity','priorSubmission','domainEvent','commandReceipt','fileVersion') THEN RAISE EXCEPTION 'Immutable task record' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_task_versions BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_task_versions_fn();
