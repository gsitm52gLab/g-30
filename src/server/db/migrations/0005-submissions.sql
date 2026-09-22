CREATE UNIQUE INDEX IF NOT EXISTS submission_shared_draft ON records(json_extract(data, '$.taskId')) WHERE kind = 'submissionDraft';
CREATE UNIQUE INDEX IF NOT EXISTS submission_sequence ON records(json_extract(data, '$.taskId'), json_extract(data, '$.sequence')) WHERE kind = 'submission';
CREATE UNIQUE INDEX IF NOT EXISTS submission_consumed_draft ON records(json_extract(data, '$.draftId'), json_extract(data, '$.committedDraftRevision')) WHERE kind = 'submission';
CREATE UNIQUE INDEX IF NOT EXISTS submission_upload_key ON records(json_extract(data, '$.submissionUpload.key')) WHERE kind = 'fileVersion' AND json_extract(data, '$.submissionUpload.key') IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS immutable_submission_version BEFORE UPDATE ON records WHEN OLD.kind = 'submission'
BEGIN SELECT RAISE(ABORT, 'Immutable submission'); END;
CREATE TRIGGER IF NOT EXISTS immutable_submission_delete BEFORE DELETE ON records WHEN OLD.kind = 'submission'
BEGIN SELECT RAISE(ABORT, 'Immutable submission'); END;
