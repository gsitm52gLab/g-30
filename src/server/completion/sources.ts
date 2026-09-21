import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { ExactSource, ExternalActor } from '@/domain/completion/types';
import { activeMember, canAdmin } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { canReferenceFile } from '@/server/files/access';
import { fileMetadata } from '@/server/files/service';
import { readProductUse } from '@/server/products/capture';
import { unavailable } from '@/server/auth/errors';
import { userLabel } from '@/server/submissions/access';
import * as safe from './stored';
export function actorCheck(s: UnitOfWork, task: StoredRecord<'task'>, actor: ExternalActor) { if (actor.kind === 'user') {
    const u = s.get('user', actor.userId);
    if (!u || u.data.status !== 'active' || !activeMember(s, u.id, task.contextId!) && !canAdmin(u, task.contextId!))
        unavailable();
} }
export const actorDTO = (s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, actor: ExternalActor) => actor.kind === 'user' ? { kind: 'user' as const, userId: actor.userId, label: safe.text(userLabel(s, p, task.contextId!, actor.userId), 200) } : { kind: 'external' as const, label: actor.label, source: actor.source };
export function authorizedFile(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, id: string, clock: Clock, publicOnly = false) { const f = s.get('fileVersion', id); if (!f || publicOnly && f.data.visibility !== 'public')
    unavailable(); canReferenceFile(s, p, f, taskScope(task), clock); return { ...fileMetadata(f), sha256: safe.hash(f.data.sha256) }; }
/** A selection is a reference to an existing immutable request/submission, never a latest replacement. */
export function exactSource(s: UnitOfWork, p: Principal, task: StoredRecord<'task'>, input: ExactSource, clock: Clock) {
    const source = safe.source(input), r = s.get('requestVersion', source.requestId);
    if (!r || r.contextId !== task.contextId || r.data.taskId !== task.id)
        unavailable();
    const sub = source.submissionId ? s.get('submission', source.submissionId) : null;
    if (source.submissionId && (!sub || sub.contextId !== task.contextId || sub.data.taskId !== task.id || sub.data.requestId !== r.id || sub.data.contentHash !== source.submissionContentHash))
        unavailable();
    const products = source.productUseIds.map(id => { const u = s.get('productUseSnapshot', id); if (!sub || !sub.data.productUseIds.includes(id) || u?.data.ownerType !== 'submission' || u.data.ownerId !== sub.id || u.data.taskId !== task.id || u.data.requestId !== r.id)
        unavailable(); return readProductUse(s, p, id, clock); });
    const permitted = new Set([...(sub?.data.fileVersionIds ?? r.data.content.referenceFileIds), ...products.flatMap(u => u.files.map(f => f.fileVersionId))]);
    const files = source.fileVersionIds.map(id => { if (!permitted.has(id))
        unavailable(); return authorizedFile(s, p, task, id, clock, true); });
    return { source, requestSequence: safe.count(r.data.sequence, 1), submissionSequence: sub ? safe.count(sub.data.sequence, 1) : null, files, products };
}
