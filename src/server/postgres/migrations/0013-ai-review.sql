CREATE UNIQUE INDEX IF NOT EXISTS ai_analysis_attempt ON __SCHEMA__.records((NULLIF(data #> '{inputVersionId}', 'null'::jsonb)),(NULLIF(data #> '{attempt}', 'null'::jsonb))) WHERE kind='aiAnalysisRun';
CREATE UNIQUE INDEX IF NOT EXISTS ai_analysis_result_run ON __SCHEMA__.records((NULLIF(data #> '{runId}', 'null'::jsonb))) WHERE kind='aiAnalysisResult';
CREATE UNIQUE INDEX IF NOT EXISTS ai_finding_review_key ON __SCHEMA__.records((NULLIF(data #> '{runId}', 'null'::jsonb)),(NULLIF(data #> '{findingId}', 'null'::jsonb))) WHERE kind='aiFindingReview';
CREATE UNIQUE INDEX IF NOT EXISTS ai_review_action_sequence ON __SCHEMA__.records((NULLIF(data #> '{reviewId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='aiFindingReviewAction';
CREATE FUNCTION __SCHEMA__.immutable_ai_review_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiCorpusRelease','aiAnalysisResult','aiFindingReviewAction') THEN RAISE EXCEPTION 'Immutable AI review fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_ai_review_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_review_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_ai_review_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiCorpusRelease','aiAnalysisResult','aiFindingReviewAction') THEN RAISE EXCEPTION 'Immutable AI review fact' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_ai_review_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_review_delete_fn();
