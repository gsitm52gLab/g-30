-- Equivalent to SQLite0017; no historical applied SQL is altered.
CREATE UNIQUE INDEX storage_grant_identity ON __SCHEMA__.records((data#>>'{identity,dedupeKey}')) WHERE kind='storageUploadGrant';
CREATE UNIQUE INDEX storage_object_grant ON __SCHEMA__.records((data->>'grantId')) WHERE kind='storageObject';
CREATE INDEX storage_stage_actor ON __SCHEMA__.records((data->>'actorId'),(data->>'expiresAt')) WHERE kind='importStage';
CREATE FUNCTION __SCHEMA__.storage_guard_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' AND OLD.kind IN ('storageUploadGrant','storageObject','importStage') THEN RAISE EXCEPTION 'Durable storage history' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF OLD.kind='storageObject' THEN RAISE EXCEPTION 'Immutable storage descriptor' USING ERRCODE='23514'; END IF;
 IF OLD.kind='storageUploadGrant' AND (
   OLD.context_id IS DISTINCT FROM NEW.context_id OR OLD.id IS DISTINCT FROM NEW.id OR OLD.kind IS DISTINCT FROM NEW.kind OR
   OLD.data->>'state' IN ('ready','cleaned') OR OLD.data->'identity' IS DISTINCT FROM NEW.data->'identity' OR
   OLD.data->'objectId' IS DISTINCT FROM NEW.data->'objectId' OR OLD.data->'appExpiresAt' IS DISTINCT FROM NEW.data->'appExpiresAt' OR
   (NEW.data->>'safeCleanupAfter')::bigint < (OLD.data->>'safeCleanupAfter')::bigint OR
   (OLD.data->>'promotionStarted'='true' AND NEW.data->>'promotionStarted' IS DISTINCT FROM 'true')
 ) THEN RAISE EXCEPTION 'Immutable storage grant identity' USING ERRCODE='23514'; END IF;
 IF OLD.kind='importStage' AND (
   OLD.context_id IS DISTINCT FROM NEW.context_id OR OLD.id IS DISTINCT FROM NEW.id OR OLD.kind IS DISTINCT FROM NEW.kind OR
   NOT ((OLD.data->>'state'='active' AND NEW.data->>'state' IN ('consumed','expired')) OR (OLD.data->>'state'='consumed' AND NEW.data->>'state'='expired')) OR
   (NEW.data->>'state'='expired' AND NEW.data->>'payload' IS NOT NULL) OR
   (NEW.data->>'state'='consumed' AND OLD.data->'payload' IS DISTINCT FROM NEW.data->'payload') OR
   (OLD.data - 'state' - 'payload') IS DISTINCT FROM (NEW.data - 'state' - 'payload')
 ) THEN RAISE EXCEPTION 'Immutable import stage content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$fn$;
CREATE TRIGGER storage_no_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.storage_guard_fn();
CREATE TRIGGER storage_object_no_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW WHEN (OLD.kind='storageObject') EXECUTE FUNCTION __SCHEMA__.storage_guard_fn();
CREATE TRIGGER storage_grant_guard BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW WHEN (OLD.kind='storageUploadGrant') EXECUTE FUNCTION __SCHEMA__.storage_guard_fn();
CREATE TRIGGER storage_stage_guard BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW WHEN (OLD.kind='importStage') EXECUTE FUNCTION __SCHEMA__.storage_guard_fn();
