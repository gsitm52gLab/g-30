import { StoreError, type RecordInput, type RecordKind, type UnitOfWork } from '../records';
import { readCorpusRelease } from './corpus';
const kinds = ['aiCorpusRelease', 'aiCorpusHead', 'aiAnalysisRun', 'aiAnalysisResult', 'aiFindingReview', 'aiFindingReviewAction'] as const;
const immutable: readonly string[] = ['aiCorpusRelease', 'aiAnalysisResult', 'aiFindingReviewAction'];
export function aiReviewRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
  if (!(kinds as readonly string[]).includes(kind)) return;
  const bad = (): never => { throw new StoreError('INVALID_RECORD'); }, d = input.data as unknown as Record<string, unknown>;
  const identifier = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v) ? v : bad();
  if (immutable.includes(kind) && s.get(kind, input.id)) bad();
  if (kind === 'aiCorpusRelease') {
    if (input.contextId !== null || typeof d.payload !== 'string') bad();
    try { const release = readCorpusRelease(JSON.parse(d.payload as string)); if (release.id !== input.id || release.manifestHash !== d.manifestHash) bad(); } catch { bad(); }
    return;
  }
  if (kind === 'aiCorpusHead') { if (input.contextId !== null || input.id !== 'ai-corpus-current' || !s.get('aiCorpusRelease', identifier(d.releaseId))) bad(); return; }
  if (!input.contextId || !s.get('context', input.contextId)) bad();
  if (kind === 'aiAnalysisRun') {
    const version = s.get('aiVersion', identifier(d.inputVersionId)), extraction = s.get('aiRun', identifier(d.extractionRunId)), snap = s.get('aiSnapshot', identifier(d.extractionSnapshotId)), corpus = s.get('aiCorpusRelease', identifier(d.corpusReleaseId));
    if (version?.contextId !== input.contextId || version.data.inputId !== d.inputId || extraction?.data.versionId !== version.id || snap?.data.runId !== extraction.id || extraction.data.snapshotId !== snap.id || snap.data.snapshotHash !== d.snapshotHash || corpus?.data.manifestHash !== d.corpusManifestHash) bad();
    if (d.taskId !== null && (version!.data.submission?.taskId !== d.taskId || s.get('task', identifier(d.taskId))?.contextId !== input.contextId)) bad();
    if (!s.get('user', identifier(d.createdBy)) || !['synthetic_demo', 'provider'].includes(String(d.engine)) || !['queued', 'running', 'finished', 'failed'].includes(String(d.state)) || !Number.isSafeInteger(d.attempt) || Number(d.attempt) < 1) bad();
    if (s.list('aiAnalysisRun', input.contextId!).some(r => r.id !== input.id && r.data.inputVersionId === d.inputVersionId && r.data.attempt === d.attempt)) throw new StoreError('CONFLICT');
    if (d.previousRunId !== null && s.get('aiAnalysisRun', identifier(d.previousRunId))?.data.inputVersionId !== d.inputVersionId) bad();
    if (d.resultId !== null && s.get('aiAnalysisResult', identifier(d.resultId))?.data.runId !== input.id) bad();
    return;
  }
  const run = s.get('aiAnalysisRun', identifier(d.runId)); if (run?.contextId !== input.contextId) bad();
  if (kind === 'aiAnalysisResult') {
    if (s.list('aiAnalysisResult', input.contextId!).some(r => r.data.runId === d.runId)) throw new StoreError('CONFLICT');
    return;
  }
  const result = s.get('aiAnalysisResult', identifier(d.resultId));
  if (result?.contextId !== input.contextId || result.data.runId !== d.runId || !/^finding-[1-9]\d*$/.test(identifier(d.findingId))) bad();
  if (kind === 'aiFindingReview') {
    if (s.list('aiFindingReview', input.contextId!).some(r => r.id !== input.id && r.data.runId === d.runId && r.data.findingId === d.findingId)) throw new StoreError('CONFLICT');
    if (d.currentActionId !== null && s.get('aiFindingReviewAction', identifier(d.currentActionId))?.data.reviewId !== input.id) bad();
  } else {
    const review = s.get('aiFindingReview', identifier(d.reviewId));
    if (!review || review.data.resultId !== d.resultId || review.data.findingId !== d.findingId || !s.get('user', identifier(d.reviewedBy)) || !Number.isSafeInteger(d.sequence) || Number(d.sequence) < 1 || !['accept', 'edit', 'reject'].includes(String(d.decision))) bad();
    if (d.previousActionId !== null && s.get('aiFindingReviewAction', identifier(d.previousActionId))?.data.reviewId !== review!.id) bad();
    if (s.list('aiFindingReviewAction', input.contextId!).some(r => r.data.reviewId === d.reviewId && r.data.sequence === d.sequence)) throw new StoreError('CONFLICT');
  }
}
