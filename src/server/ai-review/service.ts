import { AiProviderService } from '@/server/ai-provider/service';
import { createHash } from 'node:crypto';
import type { IdentityService } from '@/server/auth/service';
import type { ExtractionSnapshot } from '@/domain/ai-input/types';
import { id, obj, str } from '@/domain/ai-input/validate';
import { parseHumanReview } from '@/domain/ai-review/review';
import { validateAnalysisResult } from '@/domain/ai-review/results';
import { contentHash, ReviewContractError, sha256 } from '@/domain/ai-review/validate';
import { AuthError, fail, unavailable } from '@/server/auth/errors';
import { audit, fresh, newId, receipt } from '@/server/products/store';
import { loadRequest } from '@/server/ai-input/sources';
import { fileDirectory } from '@/server/ai-input/assets';
import { extractionSource, resolveAnalysis, reviewAccess } from './access';
import { loadCorpus } from './corpus';
import { analysisLimits, SYNTHETIC_ENGINE, syntheticAnalyze, type AnalysisEngine } from './engine';
import { analysisDetail, analysisList, analysisWorkspace, findingReview, rawResult, runSummary } from './read';
import { resolvedResult } from './result';
import { runData } from './stored';
type Hooks = {
    analyze?: AnalysisEngine;
    afterOriginalLoad?: () => Promise<void>;
    afterAnalysis?: () => Promise<void>;
    fault?: (stage: string) => void;
};
export class AiReviewService {
    constructor(readonly identity: IdentityService, readonly directory = fileDirectory(), private hooks: Hooks = {}) { }
    get clock() { return this.identity.clock; }
    async list(token: string | undefined, contextId: string) { return this.identity.repo.transaction(async (s) => (await analysisList(s, (await this.identity.principal(s, token)), id(contextId), this.clock))); }
    async workspace(token: string | undefined, inputId: string, versionId?: string) { return this.identity.repo.transaction(async (s) => (await analysisWorkspace(s, (await this.identity.principal(s, token)), id(inputId), this.clock, versionId === undefined ? undefined : id(versionId)))); }
    async detail(token: string | undefined, runId: string) { return this.identity.repo.transaction(async (s) => (await analysisDetail(s, (await this.identity.principal(s, token)), id(runId), this.clock))); }
    async raw(token: string | undefined, runId: string) { return this.identity.repo.transaction(async (s) => (await rawResult(s, (await this.identity.principal(s, token)), id(runId), this.clock))); }
    async corpus(token: string | undefined, contextId: string, releaseId?: string) { return this.identity.repo.transaction(async (s) => { (await reviewAccess(s, (await this.identity.principal(s, token)), id(contextId), this.clock)); const current = (await loadCorpus(s)), release = releaseId === undefined ? current : (await loadCorpus(s, id(releaseId))); return { release, isCurrent: release.id === current.id, currentReleaseId: current.id, editAllowed: false, deploymentOwned: true }; }); }
    private async originalBytes(token: string | undefined, inputId: string, versionId: string, snapshot: ExtractionSnapshot) {
        const request = await loadRequest(this.identity, token, inputId, versionId, this.directory), sources = request.kind === 'images' ? request.sources : [request.source];
        if (sources.length !== snapshot.sources.length || sources.some((source, index) => {
            const expected = snapshot.sources[index], verified = createHash('sha256').update(request.kind === 'text' ? request.text : 'bytes' in source ? source.bytes : new Uint8Array()).digest('hex');
            return expected.sourceId !== source.sourceId || expected.versionId !== source.versionId || expected.contextId !== source.contextId || expected.sha256 !== source.sha256 || verified !== expected.sha256;
        }))
            fail('SOURCE_CHANGED', 409, '읽은 원본이 변경되었습니다. 원본과 읽기 버전을 확인해 주세요.');
    }
    async start(token: string | undefined, inputIdValue: string, raw: Record<string, unknown>) {
        if (raw.engine === 'provider')
            return new AiProviderService(this.identity, this.directory).start(token, inputIdValue, raw);
        const input = obj(raw, ['inputVersionId', 'extractionRunId', 'expectedRunId', 'corpusReleaseId', 'corpusManifestHash', 'engine', 'idempotencyKey']), inputId = id(inputIdValue), versionId = id(input.inputVersionId), extractionRunId = id(input.extractionRunId);
        const corpusReleaseId = id(input.corpusReleaseId), corpusManifestHash = str(input.corpusManifestHash, 64);
        str(input.idempotencyKey);
        if (input.expectedRunId !== null)
            id(input.expectedRunId);
        if (input.engine !== 'synthetic_demo')
            fail('ENGINE_UNAVAILABLE', 422, '현재는 명시적인 합성 데모 엔진만 사용할 수 있습니다.');
        const claimed = await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), source = (await extractionSource(s, p, inputId, versionId, extractionRunId, this.clock)), contextId = source.input.contextId!;
            (await reviewAccess(s, p, contextId, this.clock, true));
            const corpus = (await loadCorpus(s));
            const saved = (await receipt(s, p, contextId, `ai.analysis:${inputId}:${versionId}`, input, async () => {
                if (corpus.id !== corpusReleaseId || corpus.manifestHash !== corpusManifestHash)
                    fail('CORPUS_CHANGED', 409, '현행 근거 버전을 다시 확인한 뒤 분석해 주세요.');
                const previous = (await s.list('aiAnalysisRun', contextId)).filter(r => r.data.inputVersionId === versionId).sort((a, b) => runData(b.data).attempt - runData(a.data).attempt)[0];
                if ((previous?.id ?? null) !== input.expectedRunId)
                    fail('CONFLICT', 409, '현재 분석 실행을 다시 확인해 주세요.');
                if (previous) {
                    const summary = runSummary(previous, this.clock), d = runData(previous.data), sameBasis = d.extractionRunId === extractionRunId && d.corpusReleaseId === corpus.id && d.engine === SYNTHETIC_ENGINE.engine && d.modelId === SYNTHETIC_ENGINE.modelId && d.promptVersion === SYNTHETIC_ENGINE.promptVersion;
                    if (summary.state === 'queued') {
                        if (sameBasis)
                            return { ids: [previous.id] };
                        // Explicitly replacing a stale queued basis must not strand all later work on this version.
                        (await s.update('aiAnalysisRun', previous.id, previous.revision, { ...d, state: 'failed', issue: d.corpusReleaseId !== corpus.id ? 'CORPUS_CHANGED' : 'SOURCE_CHANGED', endedAt: this.clock(), leaseUntil: null }));
                    }
                    if (summary.state === 'running')
                        fail('RUN_ACTIVE', 409, '현재 분석이 실행 중입니다.');
                    if (summary.state === 'interrupted')
                        (await s.update('aiAnalysisRun', previous.id, previous.revision, { ...d, state: 'failed', issue: 'INTERRUPTED', endedAt: this.clock(), leaseUntil: null }));
                    const failures = (await s.list('aiAnalysisRun', contextId)).filter(r => r.data.inputVersionId === versionId && r.data.extractionRunId === extractionRunId && r.data.corpusReleaseId === corpus.id).sort((a, b) => b.data.attempt - a.data.attempt);
                    let consecutive = 0;
                    for (const r of failures) {
                        if (r.data.state !== 'failed')
                            break;
                        consecutive++;
                    }
                    if (sameBasis && (consecutive >= analysisLimits.retryFailures || d.state === 'failed' && d.issue === 'RESULT_INVALID'))
                        fail('RETRY_UNAVAILABLE', 409, '오류 원인을 확인하고 새 읽기 또는 근거 버전으로 다시 시작해 주세요.');
                }
                if ((await s.list('aiAnalysisRun')).filter(r => r.data.state === 'queued').length >= analysisLimits.queued)
                    fail('QUEUE_FULL', 503, '분석 대기 작업이 많습니다. 입력을 유지한 채 다시 시도해 주세요.');
                const run = (await s.create('aiAnalysisRun', { id: newId(), contextId, data: { inputId, inputVersionId: versionId, extractionRunId, extractionSnapshotId: source.snapshotRow.id, snapshotHash: source.snapshot.snapshotHash, corpusReleaseId: corpus.id, corpusManifestHash: corpus.manifestHash, engine: SYNTHETIC_ENGINE.engine, modelId: SYNTHETIC_ENGINE.modelId, promptVersion: SYNTHETIC_ENGINE.promptVersion, providerCalled: false, taskId: source.content.submission?.taskId ?? null, createdBy: p.user.id, attempt: (previous?.data.attempt ?? 0) + 1, previousRunId: previous?.id ?? null, state: 'queued', claimId: null, leaseUntil: null, startedAt: null, endedAt: null, resultId: null, issue: null } }));
                this.hooks.fault?.('queue');
                return { ids: [run.id] };
            }));
            const row = (await s.get('aiAnalysisRun', saved.ids[0]));
            if (!row || row.data.inputVersionId !== versionId || row.data.extractionRunId !== extractionRunId)
                unavailable();
            const d = runData(row.data);
            if (d.state !== 'queued' || (await s.list('aiAnalysisRun')).filter(r => r.data.state === 'running' && !!r.data.leaseUntil && r.data.leaseUntil > this.clock()).length >= analysisLimits.concurrent)
                return { runId: row.id, claimId: null, snapshot: source.snapshot, corpus };
            if (d.corpusReleaseId !== corpus.id || d.corpusManifestHash !== corpus.manifestHash)
                fail('CORPUS_CHANGED', 409, '대기 실행의 근거 버전이 변경되었습니다. 현재 실행과 corpus를 확인해 주세요.');
            const claimId = newId();
            (await s.update('aiAnalysisRun', row.id, row.revision, { ...d, state: 'running', claimId, leaseUntil: new Date(Date.parse(this.clock()) + analysisLimits.leaseMs).toISOString(), startedAt: this.clock() }));
            this.hooks.fault?.('claim');
            return { runId: row.id, claimId, snapshot: source.snapshot, corpus };
        });
        if (claimed.claimId) {
            try {
                await this.originalBytes(token, inputId, versionId, claimed.snapshot);
                await this.hooks.afterOriginalLoad?.();
                // Local IO admission is not a lasting role grant. Recheck staff/source and claim immediately before engine dispatch.
                await this.identity.repo.transaction(async (s) => {
                    const r = (await resolveAnalysis(s, (await this.identity.principal(s, token)), claimed.runId, this.clock, true)), corpus = (await loadCorpus(s));
                    if (r.data.state !== 'running' || r.data.claimId !== claimed.claimId || !r.data.leaseUntil || r.data.leaseUntil <= this.clock())
                        fail('INTERRUPTED', 409, '분석 실행 시간이 만료되었습니다.');
                    if (corpus.id !== r.data.corpusReleaseId || corpus.manifestHash !== r.data.corpusManifestHash)
                        fail('CORPUS_CHANGED', 409, '현행 근거 버전을 확인해 주세요.');
                });
                const rawResult = await (this.hooks.analyze ?? syntheticAnalyze)(claimed.snapshot, claimed.corpus);
                await this.hooks.afterAnalysis?.();
                await this.originalBytes(token, inputId, versionId, claimed.snapshot);
                await this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token)), r = (await resolveAnalysis(s, p, claimed.runId, this.clock, true)), current = (await loadCorpus(s));
                    if (r.data.state !== 'running' || r.data.claimId !== claimed.claimId || !r.data.leaseUntil || r.data.leaseUntil <= this.clock())
                        fail('INTERRUPTED', 409, '분석 실행 시간이 만료되었습니다. 현재 상태를 확인해 주세요.');
                    if (current.id !== r.data.corpusReleaseId || current.manifestHash !== r.data.corpusManifestHash)
                        fail('CORPUS_CHANGED', 409, '실행 중 근거 버전이 변경되었습니다. 새 버전을 확인해 주세요.');
                    let result;
                    try {
                        result = validateAnalysisResult(rawResult, r.snapshot, r.row.contextId!, r.data.snapshotHash, current, current.sources);
                    }
                    catch (error) {
                        if (error instanceof ReviewContractError)
                            fail('RESULT_INVALID', 422, '분석 결과의 구조 또는 원문 위치를 확인할 수 없습니다.');
                        throw error;
                    }
                    const stored = (await s.create('aiAnalysisResult', { id: newId(), contextId: r.row.contextId, data: { runId: r.row.id, raw: rawResult, rawHash: sha256(rawResult), payload: JSON.stringify(result), resultHash: contentHash(result) } }));
                    (await s.update('aiAnalysisRun', r.row.id, r.row.revision, { ...r.data, state: 'finished', resultId: stored.id, issue: null, endedAt: this.clock(), leaseUntil: null }));
                    (await audit(s, p, this.clock, r.row.contextId!, 'ai.analysis.finished', r.row.id, {}, { resultId: stored.id, engine: r.data.engine }));
                    this.hooks.fault?.('result');
                });
            }
            catch (error) {
                const code = error instanceof AuthError ? error.code : 'ENGINE_ERROR';
                const issue = error instanceof AuthError && [401, 403, 404].includes(error.status) ? 'ACCESS_CHANGED' as const : ['RESULT_INVALID', 'SOURCE_CHANGED', 'CORPUS_CHANGED', 'INTERRUPTED'].includes(code) ? code as 'RESULT_INVALID' | 'SOURCE_CHANGED' | 'CORPUS_CHANGED' | 'INTERRUPTED' : 'ENGINE_ERROR' as const;
                await this.identity.repo.transaction(async (s) => { const row = (await s.get('aiAnalysisRun', claimed.runId)); if (row && row.data.state === 'running' && row.data.claimId === claimed.claimId)
                    (await s.update('aiAnalysisRun', row.id, row.revision, { ...runData(row.data), state: 'failed', issue, endedAt: this.clock(), leaseUntil: null })); });
                if (error instanceof AuthError)
                    throw error;
                fail('ENGINE_ERROR', 503, '분석을 처리하지 못했습니다. 실패 기록을 확인한 뒤 다시 시도해 주세요.');
            }
        }
        return { runId: claimed.runId, detail: await this.detail(token, claimed.runId) };
    }
    async review(token: string | undefined, runId: string, raw: Record<string, unknown>) {
        const input = obj(raw, ['findingId', 'expectedRevision', 'decision', 'reason', 'editedSuggestion', 'idempotencyKey']);
        str(input.idempotencyKey);
        let command;
        try {
            command = parseHumanReview(input);
        }
        catch {
            return fail('VALIDATION', 422, '검토 판단과 사유·수정안을 확인해 주세요.');
        }
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolvedResult(s, p, id(runId), this.clock));
            (await reviewAccess(s, p, r.row.contextId!, this.clock, true));
            if (!r.result.findings.some(f => f.id === command.findingId))
                unavailable();
            const saved = (await receipt(s, p, r.row.contextId!, `ai.review:${runId}:${command.findingId}`, input, async () => {
                const current = (await s.list('aiFindingReview', r.row.contextId!)).find(x => x.data.runId === runId && x.data.findingId === command.findingId);
                fresh(current ?? null, command.expectedRevision);
                const history = (await findingReview(s, p, r.row, command.findingId)), root = current ?? (await s.create('aiFindingReview', { id: newId(), contextId: r.row.contextId, data: { runId, resultId: r.resultRow.id, findingId: command.findingId, currentActionId: null } }));
                const action = (await s.create('aiFindingReviewAction', { id: newId(), contextId: r.row.contextId, data: { runId, resultId: r.resultRow.id, reviewId: root.id, findingId: command.findingId, previousActionId: history.current?.id ?? null, sequence: (history.current?.sequence ?? 0) + 1, decision: command.decision, reason: command.reason, editedSuggestion: command.editedSuggestion, reviewedBy: p.user.id, reviewedAt: this.clock() } }));
                (await s.update('aiFindingReview', root.id, root.revision, { ...root.data, currentActionId: action.id }));
                (await audit(s, p, this.clock, r.row.contextId!, 'ai.finding.reviewed', action.id, {}, { runId, findingId: command.findingId, decision: command.decision }));
                (await s.create('domainEvent', { id: newId(), contextId: r.row.contextId, data: { eventType: 'AI_REVIEW_INTERNAL_UPDATED', targetId: r.data.inputId, sourceVersionId: action.id, actorId: p.user.id, at: this.clock() } }));
                this.hooks.fault?.('review');
                return { ids: [action.id] };
            }));
            return { actionId: saved.ids[0], detail: (await analysisDetail(s, p, runId, this.clock)) };
        });
    }
}
