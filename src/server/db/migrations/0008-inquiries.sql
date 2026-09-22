CREATE UNIQUE INDEX IF NOT EXISTS inquiry_message_intent ON records(json_extract(data,'$.conversationId'),json_extract(data,'$.authorId'),json_extract(data,'$.clientMessageId')) WHERE kind='inquiryMessage';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_event_position ON records(json_extract(data,'$.conversationId'),json_extract(data,'$.lane'),json_extract(data,'$.position')) WHERE kind='inquiryEvent';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_read_fact ON records(json_extract(data,'$.conversationId'),json_extract(data,'$.userId'),json_extract(data,'$.throughMessageId')) WHERE kind='inquiryRead';
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_cursor_token ON records(json_extract(data,'$.token')) WHERE kind='inquiryCursor';
CREATE TRIGGER IF NOT EXISTS immutable_inquiry_update BEFORE UPDATE ON records WHEN OLD.kind IN ('inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent','inquiryCursor')
BEGIN SELECT RAISE(ABORT,'Immutable inquiry fact'); END;
CREATE TRIGGER IF NOT EXISTS immutable_inquiry_delete BEFORE DELETE ON records WHEN OLD.kind IN ('inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent','inquiryCursor')
BEGIN SELECT RAISE(ABORT,'Immutable inquiry fact'); END;
