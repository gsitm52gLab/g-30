CREATE UNIQUE INDEX IF NOT EXISTS ai_version_sequence ON records(json_extract(data,'$.inputId'),json_extract(data,'$.sequence')) WHERE kind='aiVersion';
CREATE UNIQUE INDEX IF NOT EXISTS ai_run_attempt ON records(json_extract(data,'$.versionId'),json_extract(data,'$.attempt')) WHERE kind='aiRun';
CREATE UNIQUE INDEX IF NOT EXISTS ai_snapshot_run ON records(json_extract(data,'$.runId')) WHERE kind='aiSnapshot';
CREATE TRIGGER IF NOT EXISTS immutable_ai_update BEFORE UPDATE ON records WHEN OLD.kind IN ('aiAsset','aiVersion','aiSnapshot') BEGIN SELECT RAISE(ABORT,'Immutable AI input fact'); END;
CREATE TRIGGER IF NOT EXISTS immutable_ai_delete BEFORE DELETE ON records WHEN OLD.kind IN ('aiAsset','aiVersion','aiSnapshot') BEGIN SELECT RAISE(ABORT,'Immutable AI input fact'); END;
