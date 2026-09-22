-- Durable upload grants and exact final descriptors. Legacy file rows are never rewritten.
CREATE UNIQUE INDEX storage_grant_identity ON records(json_extract(data,'$.identity.dedupeKey')) WHERE kind='storageUploadGrant';
CREATE UNIQUE INDEX storage_object_grant ON records(json_extract(data,'$.grantId')) WHERE kind='storageObject';
CREATE INDEX storage_stage_actor ON records(json_extract(data,'$.actorId'),json_extract(data,'$.expiresAt')) WHERE kind='importStage';
CREATE TRIGGER storage_no_delete BEFORE DELETE ON records WHEN OLD.kind IN ('storageUploadGrant','storageObject','importStage')
BEGIN SELECT RAISE(ABORT,'Durable storage history'); END;
CREATE TRIGGER storage_object_no_update BEFORE UPDATE ON records WHEN OLD.kind='storageObject'
BEGIN SELECT RAISE(ABORT,'Immutable storage descriptor'); END;
CREATE TRIGGER storage_grant_guard BEFORE UPDATE ON records WHEN OLD.kind='storageUploadGrant' AND (
 OLD.context_id IS NOT NEW.context_id OR OLD.id IS NOT NEW.id OR OLD.kind IS NOT NEW.kind OR
 json_extract(OLD.data,'$.state') IN ('ready','cleaned') OR
 json_extract(OLD.data,'$.objectId') IS NOT json_extract(NEW.data,'$.objectId') OR
 json_extract(OLD.data,'$.appExpiresAt') IS NOT json_extract(NEW.data,'$.appExpiresAt') OR
 json_extract(NEW.data,'$.safeCleanupAfter') < json_extract(OLD.data,'$.safeCleanupAfter') OR
 (json_extract(OLD.data,'$.promotionStarted')=1 AND json_extract(NEW.data,'$.promotionStarted') IS NOT 1) OR
 EXISTS(SELECT fullkey,type,atom FROM json_tree(OLD.data,'$.identity') EXCEPT SELECT fullkey,type,atom FROM json_tree(NEW.data,'$.identity')) OR
 EXISTS(SELECT fullkey,type,atom FROM json_tree(NEW.data,'$.identity') EXCEPT SELECT fullkey,type,atom FROM json_tree(OLD.data,'$.identity'))
)
BEGIN SELECT RAISE(ABORT,'Immutable storage grant identity'); END;
CREATE TRIGGER storage_stage_guard BEFORE UPDATE ON records WHEN OLD.kind='importStage' AND (
 OLD.context_id IS NOT NEW.context_id OR OLD.id IS NOT NEW.id OR OLD.kind IS NOT NEW.kind OR
 NOT ((json_extract(OLD.data,'$.state')='active' AND json_extract(NEW.data,'$.state') IN ('consumed','expired')) OR (json_extract(OLD.data,'$.state')='consumed' AND json_extract(NEW.data,'$.state')='expired')) OR
 (json_extract(NEW.data,'$.state')='expired' AND json_extract(NEW.data,'$.payload') IS NOT NULL) OR
 (json_extract(NEW.data,'$.state')='consumed' AND json_extract(NEW.data,'$.payload') IS NOT json_extract(OLD.data,'$.payload')) OR
 EXISTS(SELECT fullkey,type,atom FROM json_tree(json_remove(OLD.data,'$.state','$.payload')) EXCEPT SELECT fullkey,type,atom FROM json_tree(json_remove(NEW.data,'$.state','$.payload'))) OR
 EXISTS(SELECT fullkey,type,atom FROM json_tree(json_remove(NEW.data,'$.state','$.payload')) EXCEPT SELECT fullkey,type,atom FROM json_tree(json_remove(OLD.data,'$.state','$.payload')))
)
BEGIN SELECT RAISE(ABORT,'Immutable import stage content'); END;
