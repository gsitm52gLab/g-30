-- Additive: G00 data remains; explicit known fixtures are upgraded by seed.
CREATE UNIQUE INDEX context_combination ON __SCHEMA__.records((NULLIF(data #> '{combinationKey}', 'null'::jsonb))) WHERE kind='context' AND NULLIF(data #> '{combinationKey}', 'null'::jsonb) IS NOT NULL;
CREATE UNIQUE INDEX user_email ON __SCHEMA__.records((NULLIF(data #> '{normalizedEmail}', 'null'::jsonb))) WHERE kind='user' AND NULLIF(data #> '{normalizedEmail}', 'null'::jsonb) IS NOT NULL;
CREATE UNIQUE INDEX member_identity ON __SCHEMA__.records((context_id),(NULLIF(data #> '{userId}', 'null'::jsonb))) WHERE kind='membership';
CREATE UNIQUE INDEX credential_user ON __SCHEMA__.records((NULLIF(data #> '{userId}', 'null'::jsonb))) WHERE kind='credential';
CREATE UNIQUE INDEX session_token ON __SCHEMA__.records((NULLIF(data #> '{tokenHash}', 'null'::jsonb))) WHERE kind='session';
CREATE UNIQUE INDEX invitation_token ON __SCHEMA__.records((NULLIF(data #> '{tokenHash}', 'null'::jsonb))) WHERE kind='invitation';
CREATE FUNCTION __SCHEMA__.membership_reference_insert_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF NEW.kind='membership' THEN IF NEW.context_id IS NULL OR NOT EXISTS(SELECT 1 FROM __SCHEMA__.records WHERE kind='context' AND id=NEW.context_id) OR NOT EXISTS(SELECT 1 FROM __SCHEMA__.records WHERE kind='user' AND id=(NEW.data ->> 'userId')) THEN RAISE EXCEPTION 'INVALID_RELATION' USING ERRCODE = '23514'; END IF; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER membership_reference_insert BEFORE INSERT ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.membership_reference_insert_fn();
CREATE FUNCTION __SCHEMA__.invitation_reference_insert_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF NEW.kind='invitation' THEN IF NOT EXISTS(SELECT 1 FROM __SCHEMA__.records WHERE kind='membership' AND id=(NEW.data ->> 'membershipId') AND context_id=NEW.context_id AND NULLIF(data #> '{userId}', 'null'::jsonb)=NULLIF(NEW.data #> '{userId}', 'null'::jsonb)) THEN RAISE EXCEPTION 'INVALID_RELATION' USING ERRCODE = '23514'; END IF; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER invitation_reference_insert BEFORE INSERT ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.invitation_reference_insert_fn();
