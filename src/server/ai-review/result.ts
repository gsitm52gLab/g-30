import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { contentHash, sha256 } from '@/domain/ai-review/validate';
import { validateAnalysisResult, RESULT_LIMITS } from '@/domain/ai-review/results';
import { selectCurrentCorpus } from '@/domain/ai-review/corpus';
import { resolveAnalysis } from './access';
import { loadCorpus } from './corpus';
import { corrupt, safely } from './stored';
export async function resolvedResult(s: UnitOfWork, p: Principal, runId: string, clock: Clock) {
    const resolved = (await resolveAnalysis(s, p, runId, clock)), { data } = resolved;
    const resultRow = data.resultId ? (await s.get('aiAnalysisResult', data.resultId)) : null;
    if (!resultRow || resultRow.data.runId !== runId || resultRow.contextId !== resolved.row.contextId || data.state !== 'finished')
        corrupt();
    const corpus = (await loadCorpus(s, data.corpusReleaseId)), raw = resultRow.data.raw;
    if (corpus.manifestHash !== data.corpusManifestHash || typeof raw !== 'string' || Buffer.byteLength(raw) > RESULT_LIMITS.rawBytes || sha256(raw) !== resultRow.data.rawHash)
        corrupt();
    // Reconstruct the historical projection using the exact historical release, not today's source text.
    const result = safely(() => validateAnalysisResult(raw, resolved.snapshot, resolved.row.contextId!, data.snapshotHash, corpus, corpus.sources));
    if (contentHash(result) !== resultRow.data.resultHash || typeof resultRow.data.payload !== 'string' || resultRow.data.payload !== JSON.stringify(result))
        corrupt();
    const current = (await loadCorpus(s)), selection = selectCurrentCorpus(corpus, current.sources);
    return { ...resolved, resultRow, result, corpus, currentCorpusId: current.id, staleExcerptIds: selection.excludedStaleExcerptIds };
}
