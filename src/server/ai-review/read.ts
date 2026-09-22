import { asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { providerHistory, settingsView } from '@/server/ai-provider/projection';
import { providerEngine, providerConfig } from '@/server/ai-provider/config';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { AuthError, unavailable } from '@/server/auth/errors';
import { resolveInput, resolveVersion } from '@/server/ai-input/access';
import { userLabel } from '@/server/submissions/access';
import { hash, id, integer } from '@/domain/ai-review/validate';
import { reviewAccess, resolveAnalysis, extractionSource } from './access';
import { resolvedResult } from './result';
import { loadCorpus } from './corpus';
import { SYNTHETIC_ENGINE, analysisLimits } from './engine';
import { correctionTargets } from './source-options';
import { actionData, corrupt, runData, safely } from './stored';
export function runSummary(row: StoredRecord<'aiAnalysisRun'>, clock: Clock) {
    const data = runData(row.data), interrupted = data.state === 'running' && data.leaseUntil !== null && data.leaseUntil <= clock();
    return { id: row.id, revision: safely(() => integer(row.revision, 1)), inputId: data.inputId, inputVersionId: data.inputVersionId, extractionRunId: data.extractionRunId, extractionSnapshotId: data.extractionSnapshotId, snapshotHash: data.snapshotHash, corpusReleaseId: data.corpusReleaseId, corpusManifestHash: data.corpusManifestHash, engine: data.engine, modelId: data.modelId, promptVersion: data.promptVersion, providerCalled: data.providerCalled, attempt: data.attempt, previousRunId: data.previousRunId, state: interrupted ? 'interrupted' as const : data.state, issue: interrupted ? 'INTERRUPTED' as const : data.issue, startedAt: data.startedAt, endedAt: data.endedAt, resultId: data.resultId, createdAt: row.createdAt };
}
async function visibleRun(s: UnitOfWork, p: Principal, row: StoredRecord<'aiAnalysisRun'>, clock: Clock) {
    try {
        (await resolveAnalysis(s, p, row.id, clock));
        return [runSummary(row, clock)];
    }
    catch (error) {
        if (error instanceof AuthError && [403, 404].includes(error.status))
            return [];
        throw error;
    }
}
async function mayRestart(s: UnitOfWork, row: StoredRecord<'aiAnalysisRun'>, clock: Clock, currentCorpusId: string) {
    const summary = runSummary(row, clock);
    if (summary.state === 'running' || summary.state === 'queued')
        return false;
    if (summary.state === 'finished' || summary.corpusReleaseId !== currentCorpusId)
        return true;
    if (summary.issue === 'RESULT_INVALID')
        return false;
    const rows = (await s.list('aiAnalysisRun', row.contextId!)).filter(r => r.data.inputVersionId === summary.inputVersionId && r.data.extractionRunId === summary.extractionRunId && r.data.corpusReleaseId === currentCorpusId).map(r => runSummary(r, clock)).sort((a, b) => b.attempt - a.attempt);
    let failures = 0;
    for (const r of rows) {
        if (!['failed', 'interrupted'].includes(r.state))
            break;
        failures++;
    }
    return failures < analysisLimits.retryFailures;
}
export async function findingReview(s: UnitOfWork, p: Principal, row: StoredRecord<'aiAnalysisRun'>, findingId: string) {
    const root = (await s.list('aiFindingReview', row.contextId!)).find(r => r.data.runId === row.id && r.data.findingId === findingId);
    if (!root)
        return { revision: 0, current: null, history: [], externalExpertApproval: false as const };
    safely(() => { id(root.data.resultId); id(root.data.findingId); integer(root.revision, 1); });
    if (root.data.resultId !== row.data.resultId)
        corrupt();
    const history = (await asyncMap((await s.list('aiFindingReviewAction', row.contextId!)).filter(r => r.data.reviewId === root.id), async (r) => {
        const a = actionData(r.data);
        if (a.runId !== row.id || a.resultId !== row.data.resultId || a.findingId !== findingId)
            corrupt();
        return { id: r.id, sequence: a.sequence, decision: a.decision, reason: a.reason, editedSuggestion: a.editedSuggestion, previousActionId: a.previousActionId, reviewedByLabel: (await userLabel(s, p, row.contextId!, a.reviewedBy)), reviewedAt: a.reviewedAt };
    })).sort((a, b) => a.sequence - b.sequence);
    const current = history.find(h => h.id === root.data.currentActionId) ?? null;
    if (!current || current.id !== history.at(-1)?.id)
        corrupt();
    return { revision: root.revision, current, history, externalExpertApproval: false as const };
}
export async function analysisDetail(s: UnitOfWork, p: Principal, runId: string, clock: Clock) {
    const resolved = (await resolveAnalysis(s, p, runId, clock)), summary = runSummary(resolved.row, clock);
    const currentCorpus = (await loadCorpus(s));
    const base = { ...summary, contextId: resolved.row.contextId!, inputTitle: resolved.content.title, inputSequence: resolved.version.data.sequence, inputIsCurrent: resolved.input.data.currentVersionId === resolved.version.id, inputUrl: `/ai-input/${resolved.input.id}?context=${resolved.row.contextId}&version=${resolved.version.id}`, snapshot: resolved.snapshot,
        provider: (await providerHistory(s, runId, clock)), corpusIsCurrent: currentCorpus.id === summary.corpusReleaseId, capabilities: { review: summary.state === 'finished', rerun: (await mayRestart(s, resolved.row, clock, currentCorpus.id)), resumeQueued: summary.state === 'queued', readRaw: summary.state === 'finished' }, engineLabel: summary.engine === 'synthetic_demo' ? SYNTHETIC_ENGINE.label : '실제 provider 실행', legalApproval: false as const };
    if (!resolved.data.resultId)
        return { ...base, result: null };
    const r = (await resolvedResult(s, p, runId, clock));
    return { ...base, result: { id: r.resultRow.id, createdAt: r.resultRow.createdAt, resultHash: r.resultRow.data.resultHash, rawUrl: `/api/ai-review/runs/${runId}/raw`, ...r.result, staleExcerptIds: r.staleExcerptIds,
            findings: (await asyncMap(r.result.findings, async (f) => ({ ...f, review: (await findingReview(s, p, resolved.row, f.id)), correctionTargets: (await correctionTargets(s, p, r.content, f, clock)) }))) } };
}
export async function analysisWorkspace(s: UnitOfWork, p: Principal, inputId: string, clock: Clock, selectedVersionId?: string) {
    const input = (await resolveInput(s, p, inputId, clock));
    (await reviewAccess(s, p, input.contextId!, clock));
    const selected = selectedVersionId ?? input.data.currentVersionId;
    if (!selected)
        unavailable();
    const source = (await resolveVersion(s, p, inputId, selected, clock)), corpus = (await loadCorpus(s));
    const runs = (await asyncFlatMap((await s.list('aiAnalysisRun', input.contextId!)).filter(r => r.data.inputVersionId === selected), async (r) => (await visibleRun(s, p, r, clock)))).sort((a, b) => b.attempt - a.attempt);
    const extractionOptions = (await asyncMap((await s.list('aiRun', input.contextId!)).filter(r => r.data.versionId === selected && r.data.state === 'finished' && r.data.snapshotId !== null), async (r) => { const exact = (await extractionSource(s, p, inputId, selected, r.id, clock)); return { id: exact.extraction.id, snapshotId: exact.snapshotRow.id, attempt: safely(() => integer(r.data.attempt, 1)) }; }));
    return { inputId, contextId: input.contextId!, title: source.content.title, inputVersionId: selected, inputSequence: source.version.data.sequence, inputIsCurrent: input.data.currentVersionId === selected, extractionOptions, runs, corpus: { id: corpus.id, manifestHash: corpus.manifestHash, asOf: corpus.asOf, sourceCount: corpus.sources.length, excerptCount: corpus.excerpts.length, translationReview: 'mixed_or_unreviewed' as const, url: `/api/ai-review/corpus?contextId=${input.contextId}&releaseId=${corpus.id}` }, availableEngines: [SYNTHETIC_ENGINE, providerEngine(providerConfig().config?.model)], defaultEngine: SYNTHETIC_ENGINE.engine, providerSettings: (await settingsView(s, input.contextId!)), capabilities: { start: extractionOptions.length > 0, review: true, editCorpus: false }, limits: analysisLimits, requiresHumanReview: true, legalApproval: false };
}
export async function analysisList(s: UnitOfWork, p: Principal, contextId: string, clock: Clock) {
    (await reviewAccess(s, p, contextId, clock));
    const items = (await asyncFlatMap((await s.list('aiInput', contextId)), async (input) => { try {
        const r = (await resolveVersion(s, p, input.id, input.data.currentVersionId!, clock));
        const runs = (await asyncFlatMap((await s.list('aiAnalysisRun', contextId)).filter(run => run.data.inputId === input.id), async (run) => (await visibleRun(s, p, run, clock)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.attempt - a.attempt);
        return [{ inputId: input.id, inputVersionId: r.version.id, title: r.content.title, sequence: r.version.data.sequence, latestRun: runs[0] ?? null }];
    }
    catch (e) {
        if (e instanceof AuthError && [403, 404].includes(e.status))
            return [];
        throw e;
    } }));
    return { contextId, items, total: items.length, availableEngines: [SYNTHETIC_ENGINE, providerEngine(providerConfig().config?.model)], visibility: 'gsg_internal' as const };
}
export async function rawResult(s: UnitOfWork, p: Principal, runId: string, clock: Clock) {
    const r = (await resolvedResult(s, p, runId, clock));
    return { runId, resultId: r.resultRow.id, raw: r.resultRow.data.raw, rawHash: safely(() => hash(r.resultRow.data.rawHash)), visibility: 'gsg_internal' as const };
}
