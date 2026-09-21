CREATE UNIQUE INDEX IF NOT EXISTS evidence_version_sequence ON records(json_extract(data,'$.evidenceId'),json_extract(data,'$.sequence')) WHERE kind='evidenceVersion';
CREATE UNIQUE INDEX IF NOT EXISTS evidence_product_link ON records(context_id,json_extract(data,'$.evidenceVersionId'),json_extract(data,'$.productId')) WHERE kind='evidenceLink';
CREATE UNIQUE INDEX IF NOT EXISTS evidence_assessment_sequence ON records(json_extract(data,'$.linkId'),json_extract(data,'$.sequence')) WHERE kind='evidenceAssessment';
CREATE TRIGGER IF NOT EXISTS immutable_evidence_import_update BEFORE UPDATE ON records WHEN OLD.kind IN ('evidenceVersion','evidenceAssessment','importBatch')
BEGIN SELECT RAISE(ABORT,'Immutable evidence/import record'); END;
CREATE TRIGGER IF NOT EXISTS immutable_evidence_import_delete BEFORE DELETE ON records WHEN OLD.kind IN ('evidenceVersion','evidenceAssessment','importBatch')
BEGIN SELECT RAISE(ABORT,'Immutable evidence/import record'); END;
