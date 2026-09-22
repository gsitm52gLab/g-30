CREATE UNIQUE INDEX IF NOT EXISTS ai_analysis_attempt ON records(json_extract(data,'$.inputVersionId'),json_extract(data,'$.attempt')) WHERE kind='aiAnalysisRun';
CREATE UNIQUE INDEX IF NOT EXISTS ai_analysis_result_run ON records(json_extract(data,'$.runId')) WHERE kind='aiAnalysisResult';
CREATE UNIQUE INDEX IF NOT EXISTS ai_finding_review_key ON records(json_extract(data,'$.runId'),json_extract(data,'$.findingId')) WHERE kind='aiFindingReview';
CREATE UNIQUE INDEX IF NOT EXISTS ai_review_action_sequence ON records(json_extract(data,'$.reviewId'),json_extract(data,'$.sequence')) WHERE kind='aiFindingReviewAction';
CREATE TRIGGER IF NOT EXISTS immutable_ai_review_update BEFORE UPDATE ON records WHEN OLD.kind IN ('aiCorpusRelease','aiAnalysisResult','aiFindingReviewAction') BEGIN SELECT RAISE(ABORT,'Immutable AI review fact'); END;
CREATE TRIGGER IF NOT EXISTS immutable_ai_review_delete BEFORE DELETE ON records WHEN OLD.kind IN ('aiCorpusRelease','aiAnalysisResult','aiFindingReviewAction') BEGIN SELECT RAISE(ABORT,'Immutable AI review fact'); END;
