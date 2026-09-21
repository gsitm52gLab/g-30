import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize } from '@/server/policy/policy';
import { resolveVersion } from '@/server/ai-input/access';
import { sourceIdentities } from '@/server/ai-input/sources';
import { readSnapshot } from '@/server/ai-input/snapshot';
import { validateSnapshotBinding } from '@/domain/ai-review/locations';
import { fail, unavailable } from '@/server/auth/errors';
import { corrupt, runData, safely } from './stored';

export function reviewAccess(s: UnitOfWork, p: Principal, contextId: string, clock: Clock, manage = false) {
  return authorize(s, p, manage ? 'ai.result.manage' : 'ai.result.read', { id: contextId, contextId, kind: 'ai_result', visibility: 'internal' }, clock);
}
export function extractionSource(s: UnitOfWork, p: Principal, inputId: string, versionId: string, extractionRunId: string, clock: Clock) {
  const resolved = resolveVersion(s, p, inputId, versionId, clock);
  reviewAccess(s, p, resolved.input.contextId!, clock);
  const run = s.get('aiRun', extractionRunId), snap = run?.data.snapshotId ? s.get('aiSnapshot', run.data.snapshotId) : null;
  if (!run || run.contextId !== resolved.input.contextId || run.data.inputId !== inputId || run.data.versionId !== versionId) unavailable();
  if (run.data.state !== 'finished' || !snap) fail('EXTRACTION_NOT_READY', 409, '선택한 입력 버전의 읽기가 끝난 뒤 분석해 주세요.');
  if (snap.contextId !== run.contextId || snap.data.runId !== run.id || snap.data.inputId !== inputId || snap.data.versionId !== versionId) corrupt();
  const snapshot = readSnapshot(snap.data.payload, snap.data.snapshotHash), sources = sourceIdentities(s, resolved.version, resolved.content);
  if (JSON.stringify(snapshot.sources) !== JSON.stringify(sources)) corrupt();
  safely(() => validateSnapshotBinding(snapshot, resolved.input.contextId!, snap.data.snapshotHash));
  return { ...resolved, extraction: run, snapshotRow: snap, snapshot };
}
export function resolveAnalysis(s: UnitOfWork, p: Principal, runId: string, clock: Clock, manage = false) {
  const row = s.get('aiAnalysisRun', runId); if (!row?.contextId) unavailable();
  reviewAccess(s, p, row.contextId, clock, manage);
  const data = runData(row.data), source = extractionSource(s, p, data.inputId, data.inputVersionId, data.extractionRunId, clock);
  if (source.input.contextId !== row.contextId || source.snapshotRow.id !== data.extractionSnapshotId || source.snapshot.snapshotHash !== data.snapshotHash || source.content.submission?.taskId !== (data.taskId ?? undefined)) corrupt();
  return { row, data, ...source };
}
