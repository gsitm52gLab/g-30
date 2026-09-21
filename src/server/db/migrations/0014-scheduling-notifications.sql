CREATE UNIQUE INDEX scheduling_version_sequence ON records(json_extract(data,'$.scheduleId'),json_extract(data,'$.sequence')) WHERE kind='scheduleVersion';
CREATE UNIQUE INDEX notification_event_recipient ON records(json_extract(data,'$.key')) WHERE kind='notification';
CREATE UNIQUE INDEX notification_semantic_recipient ON records(json_extract(data,'$.semanticKey')) WHERE kind='notification' AND json_extract(data,'$.semanticKey') IS NOT NULL;
CREATE UNIQUE INDEX notification_receipt_key ON records(json_extract(data,'$.key')) WHERE kind='notificationReceipt';
CREATE TRIGGER scheduling_immutable_update BEFORE UPDATE ON records WHEN OLD.kind IN ('scheduleVersion','notificationReceipt','notificationAttempt') BEGIN SELECT RAISE(ABORT,'immutable scheduling fact'); END;
CREATE TRIGGER scheduling_immutable_delete BEFORE DELETE ON records WHEN OLD.kind IN ('scheduleVersion','notificationReceipt','notificationAttempt') BEGIN SELECT RAISE(ABORT,'immutable scheduling fact'); END;
CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON records WHEN OLD.kind='notification' AND json_remove(OLD.data,'$.readAt')<>json_remove(NEW.data,'$.readAt') BEGIN SELECT RAISE(ABORT,'immutable notification content'); END;
