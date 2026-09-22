CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_setting_context ON __SCHEMA__.records((context_id)) WHERE kind='aiProviderSetting';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_plan_run ON __SCHEMA__.records((NULLIF(data #> '{runId}', 'null'::jsonb))) WHERE kind='aiProviderPlan';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_attempt_sequence ON __SCHEMA__.records((NULLIF(data #> '{runId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='aiProviderAttempt';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_outcome_attempt ON __SCHEMA__.records((NULLIF(data #> '{attemptId}', 'null'::jsonb))) WHERE kind='aiProviderOutcome';
CREATE FUNCTION __SCHEMA__.immutable_ai_provider_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiProviderPlan','aiProviderOutcome') THEN RAISE EXCEPTION 'Immutable AI provider fact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_ai_provider_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_provider_update_fn();
CREATE FUNCTION __SCHEMA__.immutable_ai_provider_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('aiProviderPlan','aiProviderOutcome','aiProviderAttempt') THEN RAISE EXCEPTION 'Preserve AI provider history' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER immutable_ai_provider_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_ai_provider_delete_fn();
