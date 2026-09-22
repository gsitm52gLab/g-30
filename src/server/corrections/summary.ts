import { asyncFlatMap, asyncMap } from "@/domain/async-collections";
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { correctionTask, canManage } from './access';
import { batchContent, itemState, reviewDTO } from './projection';
import { exactTarget } from './targets';
/** Synchronous caller UoW. This module never imports submissions/read or recaptures products. */
export async function readCorrectionRemainder(s: UnitOfWork, p: Principal, taskId: string, clock: Clock, submissionId: string | null = null) {
    const task = (await correctionTask(s, p, taskId, clock)), batches = (await s.list('correctionBatch', task.contextId!)).filter(b => b.data.taskId === taskId).sort((a, b) => a.data.sequence - b.data.sequence);
    const items = (await asyncFlatMap(batches, async (b) => (await asyncMap(batchContent(b).items.filter(i => !submissionId || i.target.submissionId === submissionId), async (i) => { (await exactTarget(s, p, i.target, clock)); const state = (await itemState(s, p, b, i.key, clock)); return { batchVersionId: b.id, itemKey: i.key, targetSubmissionId: i.target.submissionId, status: state.status, reflectionId: state.reflectionId, resolutionId: state.resolutionId }; }))));
    return { connected: true as const, batchVersionIds: batches.filter(b => items.some(i => i.batchVersionId === b.id)).map(b => b.id), items, unresolved: items.filter(i => i.status !== 'resolved').length };
}
export async function readSubmissionReview(s: UnitOfWork, p: Principal, taskId: string, submissionId: string, clock: Clock) {
    const task = (await correctionTask(s, p, taskId, clock)), remainder = (await readCorrectionRemainder(s, p, taskId, clock, submissionId));
    // Private review existence/results must not affect brand counts, status or time.
    const reviews = (await canManage(s, p, task, clock)) ? (await asyncMap((await s.list('correctionReview', task.contextId!)).filter(r => r.data.taskId === taskId && r.data.target.submissionId === submissionId), async (r) => (await reviewDTO(s, p, r, clock)))) : [];
    return { ...remainder, status: remainder.unresolved ? 'changes_requested' as const : reviews.length ? 'recorded' as const : 'pending' as const, reviews };
}
