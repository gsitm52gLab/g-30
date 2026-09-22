CREATE UNIQUE INDEX IF NOT EXISTS notice_version_sequence ON records(json_extract(data,'$.noticeId'), json_extract(data,'$.sequence')) WHERE kind='noticeVersion';
CREATE UNIQUE INDEX IF NOT EXISTS notice_version_reader ON records(json_extract(data,'$.versionId'), json_extract(data,'$.userId')) WHERE kind='noticeRead';
CREATE TRIGGER IF NOT EXISTS immutable_notice_records_update BEFORE UPDATE ON records WHEN OLD.kind IN ('noticeVersion','noticeRead')
BEGIN SELECT RAISE(ABORT,'Immutable notice version or read'); END;
CREATE TRIGGER IF NOT EXISTS immutable_notice_records_delete BEFORE DELETE ON records WHEN OLD.kind IN ('noticeVersion','noticeRead')
BEGIN SELECT RAISE(ABORT,'Immutable notice version or read'); END;
