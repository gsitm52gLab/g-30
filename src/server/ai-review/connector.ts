import { isDeepStrictEqual } from 'node:util';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { OpinionSource, ReviewTarget } from '@/domain/corrections/types';
import { resolvedResult } from './result';
import { correctionTargets } from './source-options';
import { findingReview } from './read';
import { fail, unavailable } from '@/server/auth/errors';
export async function assertFindingSource(s: UnitOfWork, p: Principal, source: OpinionSource, target: ReviewTarget, clock: Clock) {
    if (source.kind !== 'ai_candidate')
        return;
    const r = (await resolvedResult(s, p, source.runId, clock)), finding = r.result.findings.find(f => f.id === source.findingId);
    if (!finding)
        unavailable();
    const review = (await findingReview(s, p, r.row, finding.id));
    if (!review.current || review.current.decision === 'reject')
        fail('FINDING_REVIEW_REQUIRED', 409, '후보를 수락 또는 수정 검토한 뒤 내부 의견으로 연결해 주세요.');
    const allowed = (await correctionTargets(s, p, r.content, finding, clock));
    if (!allowed.some(t => isDeepStrictEqual(t, target)))
        fail('TARGET_MISMATCH', 422, '이 후보가 실제로 읽은 제출 원문과 정확한 항목을 선택해 주세요.');
}
