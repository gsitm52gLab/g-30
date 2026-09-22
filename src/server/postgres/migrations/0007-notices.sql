CREATE UNIQUE INDEX IF NOT EXISTS notice_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{noticeId}', 'null'::jsonb)),( NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='noticeVersion';
CREATE UNIQUE INDEX IF NOT EXISTS notice_version_reader ON __SCHEMA__.records((NULLIF(data #> '{versionId}', 'null'::jsonb)),( NULLIF(data #> '{userId}', 'null'::jsonb))) WHERE kind='noticeRead';
CREATE FUNCTION __SCHEMA__.immutable_notice_records_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('noticeVersion','noticeRead') THEN RAISE EXCEPTION 'Immutable notice version or read' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_notice_records_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_notice_records_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_notice_records_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('noticeVersion','noticeRead') THEN RAISE EXCEPTION 'Immutable notice version or read' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_notice_records_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_notice_records_delete_fn();
