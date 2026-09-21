CREATE UNIQUE INDEX correction_opinion_sequence ON records(json_extract(data,'$.opinionId'),json_extract(data,'$.sequence')) WHERE kind='correctionOpinionVersion';
CREATE UNIQUE INDEX correction_batch_sequence ON records(json_extract(data,'$.taskId'),json_extract(data,'$.sequence')) WHERE kind='correctionBatch';
CREATE UNIQUE INDEX correction_batch_draft ON records(json_extract(data,'$.draftId')) WHERE kind='correctionBatch';
CREATE UNIQUE INDEX correction_item_key ON records(json_extract(data,'$.batchVersionId'),json_extract(data,'$.itemKey')) WHERE kind='correctionItemState';
CREATE TRIGGER correction_immutable_update BEFORE UPDATE ON records WHEN OLD.kind IN ('correctionOpinionVersion','correctionBatch','correctionReflection','correctionResolution','correctionReview') BEGIN SELECT RAISE(ABORT,'immutable correction fact'); END;
CREATE TRIGGER correction_immutable_delete BEFORE DELETE ON records WHEN OLD.kind IN ('correctionOpinionVersion','correctionBatch','correctionReflection','correctionResolution','correctionReview') BEGIN SELECT RAISE(ABORT,'immutable correction fact'); END;
CREATE TRIGGER correction_published_draft_update BEFORE UPDATE ON records WHEN OLD.kind='correctionDraft' AND json_extract(OLD.data,'$.publishedVersionId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable correction provenance'); END;
CREATE TRIGGER correction_published_draft_delete BEFORE DELETE ON records WHEN OLD.kind='correctionDraft' AND json_extract(OLD.data,'$.publishedVersionId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable correction provenance'); END;
