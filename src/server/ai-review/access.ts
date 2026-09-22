import { jsonContentEqual } from '@/domain/json-content';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { authorize } from '@/server/policy/policy';
import { resolveVersion } from '@/server/ai-input/access';
import { sourceIdentities } from '@/server/ai-input/sources';
import { readSnapshot } from '@/server/ai-input/snapshot';
import { validateSnapshotBinding } from '@/domain/ai-review/locations';
import { fail, unavailable } from '@/server/auth/errors';
import { corrupt, runData, safely } from './stored';
export async function reviewAccess(s: UnitOfWork, p: Principal, contextId: string, clock: Clock, manage = false) {
    return (await authorize(s, p, manage ? 'ai.result.manage' : 'ai.result.read', { id: contextId, contextId, kind: 'ai_result', visibility: 'internal' }, clock));
}
export async function extractionSource(s: UnitOfWork, p: Principal, inputId: string, versionId: string, extractionRunId: string, clock: Clock) {
    const resolved = (await resolveVersion(s, p, inputId, versionId, clock));
    (await reviewAccess(s, p, resolved.input.contextId!, clock));
    const run = (await s.get('aiRun', extractionRunId)), snap = run?.data.snapshotId ? (await s.get('aiSnapshot', run.data.snapshotId)) : null;
    if (!run || run.contextId !== resolved.input.contextId || run.data.inputId !== inputId || run.data.versionId !== versionId)
        unavailable();
    if (run.data.state !== 'finished' || !snap)
        fail('EXTRACTION_NOT_READY', 409, '선택한 입력 버전의 읽기가 끝난 뒤 분석해 주세요.');
    if (snap.contextId !== run.contextId || snap.data.runId !== run.id || snap.data.inputId !== inputId || snap.data.versionId !== versionId)
        corrupt();
    const snapshot = readSnapshot(snap.data.payload, snap.data.snapshotHash), sources = (await sourceIdentities(s, resolved.version, resolved.content));
    if (!jsonContentEqual(snapshot.sources, sources))
        corrupt();
    safely(() => validateSnapshotBinding(snapshot, resolved.input.contextId!, snap.data.snapshotHash));
    return { ...resolved, extraction: run, snapshotRow: snap, snapshot };
}
export async function resolveAnalysis(s: UnitOfWork, p: Principal, runId: string, clock: Clock, manage = false) {
    const row = (await s.get('aiAnalysisRun', runId));
    if (!row?.contextId)
        unavailable();
    (await reviewAccess(s, p, row.contextId, clock, manage));
    const data = runData(row.data), source = (await extractionSource(s, p, data.inputId, data.inputVersionId, data.extractionRunId, clock));
    if (source.input.contextId !== row.contextId || source.snapshotRow.id !== data.extractionSnapshotId || source.snapshot.snapshotHash !== data.snapshotHash || source.content.submission?.taskId !== (data.taskId ?? undefined))
        corrupt();
    return { row, data, ...source };
}
