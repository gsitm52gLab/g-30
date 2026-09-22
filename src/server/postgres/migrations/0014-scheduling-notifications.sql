CREATE UNIQUE INDEX scheduling_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{scheduleId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='scheduleVersion';
CREATE UNIQUE INDEX notification_event_recipient ON __SCHEMA__.records((NULLIF(data #> '{key}', 'null'::jsonb))) WHERE kind='notification';
CREATE UNIQUE INDEX notification_semantic_recipient ON __SCHEMA__.records((NULLIF(data #> '{semanticKey}', 'null'::jsonb))) WHERE kind='notification' AND NULLIF(data #> '{semanticKey}', 'null'::jsonb) IS NOT NULL;
CREATE UNIQUE INDEX notification_receipt_key ON __SCHEMA__.records((NULLIF(data #> '{key}', 'null'::jsonb))) WHERE kind='notificationReceipt';
CREATE FUNCTION __SCHEMA__.scheduling_immutable_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('scheduleVersion','notificationReceipt','notificationAttempt') THEN RAISE EXCEPTION 'immutable scheduling fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER scheduling_immutable_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.scheduling_immutable_update_fn();
CREATE FUNCTION __SCHEMA__.scheduling_immutable_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('scheduleVersion','notificationReceipt','notificationAttempt') THEN RAISE EXCEPTION 'immutable scheduling fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER scheduling_immutable_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.scheduling_immutable_delete_fn();
CREATE FUNCTION __SCHEMA__.notification_content_immutable_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind='notification' AND (OLD.data - 'readAt')<>(NEW.data - 'readAt') THEN RAISE EXCEPTION 'immutable notification content' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.notification_content_immutable_fn();
