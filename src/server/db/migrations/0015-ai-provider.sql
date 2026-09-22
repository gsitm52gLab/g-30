CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_setting_context ON records(context_id) WHERE kind='aiProviderSetting';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_plan_run ON records(json_extract(data,'$.runId')) WHERE kind='aiProviderPlan';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_attempt_sequence ON records(json_extract(data,'$.runId'),json_extract(data,'$.sequence')) WHERE kind='aiProviderAttempt';
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_outcome_attempt ON records(json_extract(data,'$.attemptId')) WHERE kind='aiProviderOutcome';
CREATE TRIGGER IF NOT EXISTS immutable_ai_provider_update BEFORE UPDATE ON records WHEN OLD.kind IN ('aiProviderPlan','aiProviderOutcome') BEGIN SELECT RAISE(ABORT,'Immutable AI provider fact'); END;
CREATE TRIGGER IF NOT EXISTS immutable_ai_provider_delete BEFORE DELETE ON records WHEN OLD.kind IN ('aiProviderPlan','aiProviderOutcome','aiProviderAttempt') BEGIN SELECT RAISE(ABORT,'Preserve AI provider history'); END;
