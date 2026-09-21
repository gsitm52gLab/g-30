CREATE UNIQUE INDEX completion_snapshot_sequence ON records(json_extract(data,'$.taskId'),json_extract(data,'$.sequence')) WHERE kind='completionSnapshot';
CREATE UNIQUE INDEX completion_external_sequence ON records(json_extract(data,'$.taskId'),json_extract(data,'$.sequence')) WHERE kind='completionExternalAction';
CREATE UNIQUE INDEX completion_reopen_once ON records(json_extract(data,'$.completionId')) WHERE kind='completionReopen';
CREATE TRIGGER completion_immutable_update BEFORE UPDATE ON records WHEN OLD.kind IN ('completionSnapshot','completionExternalAction','completionReopen','completionFollowup') BEGIN SELECT RAISE(ABORT,'immutable completion fact'); END;
CREATE TRIGGER completion_immutable_delete BEFORE DELETE ON records WHEN OLD.kind IN ('completionSnapshot','completionExternalAction','completionReopen','completionFollowup') BEGIN SELECT RAISE(ABORT,'immutable completion fact'); END;
