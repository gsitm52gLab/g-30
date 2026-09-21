-- Additive: G00 data remains; explicit known fixtures are upgraded by seed.
CREATE UNIQUE INDEX context_combination ON records(json_extract(data,'$.combinationKey')) WHERE kind='context' AND json_extract(data,'$.combinationKey') IS NOT NULL;
CREATE UNIQUE INDEX user_email ON records(json_extract(data,'$.normalizedEmail')) WHERE kind='user' AND json_extract(data,'$.normalizedEmail') IS NOT NULL;
CREATE UNIQUE INDEX member_identity ON records(context_id,json_extract(data,'$.userId')) WHERE kind='membership';
CREATE UNIQUE INDEX credential_user ON records(json_extract(data,'$.userId')) WHERE kind='credential';
CREATE UNIQUE INDEX session_token ON records(json_extract(data,'$.tokenHash')) WHERE kind='session';
CREATE UNIQUE INDEX invitation_token ON records(json_extract(data,'$.tokenHash')) WHERE kind='invitation';
CREATE TRIGGER membership_reference_insert BEFORE INSERT ON records WHEN NEW.kind='membership' BEGIN
 SELECT CASE WHEN NEW.context_id IS NULL OR NOT EXISTS(SELECT 1 FROM records WHERE kind='context' AND id=NEW.context_id) OR NOT EXISTS(SELECT 1 FROM records WHERE kind='user' AND id=json_extract(NEW.data,'$.userId')) THEN RAISE(ABORT,'INVALID_RELATION') END;
END;
CREATE TRIGGER invitation_reference_insert BEFORE INSERT ON records WHEN NEW.kind='invitation' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM records WHERE kind='membership' AND id=json_extract(NEW.data,'$.membershipId') AND context_id=NEW.context_id AND json_extract(data,'$.userId')=json_extract(NEW.data,'$.userId')) THEN RAISE(ABORT,'INVALID_RELATION') END;
END;
