import { asyncMap } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { AiCompletionRemainder } from '@/domain/ai-review/completion';
import type { CompletionBasis } from '@/domain/completion/types';
import { array, id, integer, object, oneOf } from '@/domain/ai-review/validate';
import { resolveAnalysis, reviewAccess } from './access';
import { analysisDetail, runSummary } from './read';
import { loadCorpus, corpusHeadId } from './corpus';
import { corrupt, safely } from './stored';
import { unavailable } from '@/server/auth/errors';
export function storedAiResidual(value: unknown): CompletionBasis['ai'] {
    return safely(() => {
        const v = object(value);
        if (v.connected === false && v.state === 'not_connected' && v.value === null)
            return { connected: false, state: 'not_connected', value: null };
        if (v.connected !== true)
            corrupt();
        if (v.state === 'unavailable' && v.value === null && v.reason === 'source_unavailable')
            return { connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' };
        if (v.state !== 'available')
            corrupt();
        const d = object(v.value), items = array(d.items, 20000).map(x => {
            const r = object(x);
            if (typeof r.staleCorpus !== 'boolean')
                corrupt();
            return { runId: id(r.runId), revision: integer(r.revision, 1), inputId: id(r.inputId), inputVersionId: id(r.inputVersionId), extractionRunId: id(r.extractionRunId), resultId: r.resultId === null ? null : id(r.resultId), state: oneOf(r.state, ['queued', 'running', 'finished', 'failed', 'interrupted']), issue: r.issue === null ? null : oneOf(r.issue, ['ENGINE_ERROR', 'RESULT_INVALID', 'ACCESS_CHANGED', 'SOURCE_CHANGED', 'CORPUS_CHANGED', 'INTERRUPTED', 'STORAGE_UNAVAILABLE']), unreviewedFindings: r.unreviewedFindings === null ? null : integer(r.unreviewedFindings), staleCorpus: r.staleCorpus };
        });
        const result = { items, failed: integer(d.failed), pending: integer(d.pending), unreviewedFindings: integer(d.unreviewedFindings) };
        if (result.failed !== items.filter(r => r.state === 'failed' || r.state === 'interrupted').length || result.pending !== items.filter(r => r.state === 'queued' || r.state === 'running').length || result.unreviewedFindings !== items.reduce((sum, r) => sum + (r.unreviewedFindings ?? 0), 0))
            corrupt();
        return { connected: true, state: 'available', value: result };
    });
}
export async function collectAiResidual(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, clock: Clock, sourceRows: StoredRecord[]): Promise<AiCompletionRemainder> {
    (await reviewAccess(s, p, task.contextId!, clock));
    const versions = (await s.list('aiVersion', task.contextId!)).filter(v => v.data.submission?.taskId === task.id), versionIds = new Set(versions.map(v => v.id));
    const runs = (await s.list('aiAnalysisRun', task.contextId!)).filter(r => r.data.taskId === task.id || versionIds.has(r.data.inputVersionId));
    const inputIds = new Set(versions.map(v => v.data.inputId)), runIds = new Set(runs.map(r => r.id));
    sourceRows.push(...versions, ...(await s.list('aiInput', task.contextId!)).filter(r => inputIds.has(r.id)), ...runs);
    for (const kind of ['aiAnalysisResult', 'aiFindingReview', 'aiFindingReviewAction'] as const)
        sourceRows.push(...(await s.list(kind, task.contextId!)).filter(r => runIds.has(r.data.runId)));
    if (runs.length) {
        const head = (await s.get('aiCorpusHead', corpusHeadId));
        if (head)
            sourceRows.push(head);
    }
    const current = (await loadCorpus(s));
    const items = (await asyncMap(runs, async (row) => {
        const r = (await resolveAnalysis(s, p, row.id, clock)), dto = runSummary(row, clock);
        if (r.data.taskId !== task.id)
            unavailable();
        sourceRows.push(r.extraction, r.snapshotRow);
        const corpus = (await s.get('aiCorpusRelease', r.data.corpusReleaseId));
        if (!corpus)
            corrupt();
        sourceRows.push(corpus);
        const detail = r.data.resultId ? (await analysisDetail(s, p, row.id, clock)) : null;
        return { runId: row.id, revision: row.revision, inputId: r.data.inputId, inputVersionId: r.data.inputVersionId, extractionRunId: r.data.extractionRunId, resultId: r.data.resultId, state: dto.state, issue: dto.issue, unreviewedFindings: detail?.result ? detail.result.findings.filter(f => !f.review.current).length : null, staleCorpus: current.id !== r.data.corpusReleaseId };
    }));
    return { items, failed: items.filter(r => r.state === 'failed' || r.state === 'interrupted').length, pending: items.filter(r => r.state === 'queued' || r.state === 'running').length, unreviewedFindings: items.reduce((sum, r) => sum + (r.unreviewedFindings ?? 0), 0) };
}
export async function authorizeAiResidual(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, value: AiCompletionRemainder, clock: Clock) {
    (await reviewAccess(s, p, task.contextId!, clock));
    for (const item of value.items) {
        const r = (await resolveAnalysis(s, p, item.runId, clock));
        if (r.row.contextId !== task.contextId || r.data.taskId !== task.id || r.data.inputId !== item.inputId || r.data.inputVersionId !== item.inputVersionId || r.data.extractionRunId !== item.extractionRunId || item.resultId !== null && r.data.resultId !== item.resultId)
            unavailable();
    }
    return value;
}
