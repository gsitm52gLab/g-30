import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { Finding } from '@/domain/ai-review/types';
import type { AiContent } from '@/domain/ai-input/records';
import type { ReviewTarget } from '@/domain/corrections/types';
import { exactTarget } from '@/server/corrections/targets';
import { AuthError, unavailable } from '@/server/auth/errors';
export function findingLocator(f: Finding) { return `segment=${f.original.segmentId}; UTF16=${f.original.start}:${f.original.end}; snapshot=${f.original.snapshotHash}`; }
/** A linked submission is not proof that arbitrary typed text came from its answers. */
export function correctionTargets(s: UnitOfWork, p: Principal, content: AiContent, finding: Finding, clock: Clock): ReviewTarget[] {
  const ref = content.submission; if (!ref) return [];
  const sub = s.get('submission', ref.submissionId); if (!sub || sub.data.taskId !== ref.taskId || sub.data.requestId !== ref.requestId) unavailable();
  const base: ReviewTarget = { taskId: ref.taskId, submissionId: sub.id, requestId: ref.requestId, submissionContentHash: sub.data.contentHash, answer: null, fileVersionIds: [], productUseIds: [...ref.productUseIds], location: { page: finding.original.location.page === null ? null : String(finding.original.location.page), locator: findingLocator(finding) } };
  const candidates: ReviewTarget[] = [];
  if (content.kind === 'text') {
    if (content.text === sub.data.narrative) candidates.push(base);
    for (const answer of sub.data.answers) {
      if ((answer.type === 'short_text' || answer.type === 'long_text') && content.text === answer.input.text) {
        const productUseIds = ref.productUseIds.filter(id => answer.productId === null || s.get('productUseSnapshot', id)?.data.productId === answer.productId);
        candidates.push({ ...base, answer: { requirementKey: answer.requirementKey, productId: answer.productId }, productUseIds });
      }
    }
  } else if (content.sources.some(x => x.kind === 'submission_file' && x.fileVersionId === finding.original.location.sourceId)) {
    candidates.push({ ...base, fileVersionIds: [finding.original.location.sourceId] });
  }
  return candidates.flatMap(target => { try { return [exactTarget(s, p, target, clock).target]; } catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return []; throw error; } });
}
