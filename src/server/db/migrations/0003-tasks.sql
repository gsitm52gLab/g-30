CREATE UNIQUE INDEX IF NOT EXISTS task_receipt_key ON records(json_extract(data, '$.key')) WHERE kind = 'commandReceipt';
CREATE UNIQUE INDEX IF NOT EXISTS task_request_sequence ON records(json_extract(data, '$.taskId'), json_extract(data, '$.sequence')) WHERE kind = 'requestVersion';
CREATE UNIQUE INDEX IF NOT EXISTS template_sequence ON records(COALESCE(context_id, ''), json_extract(data, '$.templateId'), json_extract(data, '$.sequence')) WHERE kind = 'templateVersion';
CREATE TRIGGER IF NOT EXISTS immutable_task_versions BEFORE UPDATE ON records
WHEN OLD.kind IN ('requestVersion','templateVersion','taskActivity','priorSubmission','domainEvent','commandReceipt','fileVersion')
BEGIN SELECT RAISE(ABORT, 'Immutable task record'); END;
