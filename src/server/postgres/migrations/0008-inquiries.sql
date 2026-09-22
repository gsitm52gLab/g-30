CREATE UNIQUE INDEX IF NOT EXISTS inquiry_message_intent ON __SCHEMA__.records((NULLIF(data #> '{conversationId}', 'null'::jsonb)),(NULLIF(data #> '{authorId}', 'null'::jsonb)),(NULLIF(data #> '{clientMessageId}', 'null'::jsonb))) WHERE kind='inquiryMessage';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_event_position ON __SCHEMA__.records((NULLIF(data #> '{conversationId}', 'null'::jsonb)),(NULLIF(data #> '{lane}', 'null'::jsonb)),(NULLIF(data #> '{position}', 'null'::jsonb))) WHERE kind='inquiryEvent';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_read_fact ON __SCHEMA__.records((NULLIF(data #> '{conversationId}', 'null'::jsonb)),(NULLIF(data #> '{userId}', 'null'::jsonb)),(NULLIF(data #> '{throughMessageId}', 'null'::jsonb))) WHERE kind='inquiryRead';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_cursor_token ON __SCHEMA__.records((NULLIF(data #> '{token}', 'null'::jsonb))) WHERE kind='inquiryCursor';
CREATE FUNCTION __SCHEMA__.immutable_inquiry_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent','inquiryCursor') THEN RAISE EXCEPTION 'Immutable inquiry fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_inquiry_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_inquiry_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_inquiry_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent','inquiryCursor') THEN RAISE EXCEPTION 'Immutable inquiry fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_inquiry_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_inquiry_delete_fn();
