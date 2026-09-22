/** Synthetic actual-PG adapters use the existing IdentityService and task/file policies. No route wiring. */
import { randomUUID } from 'node:crypto';
import type { RecordRepository, Clock, UnitOfWork } from '@/domain/records';
import { IdentityService } from '@/server/auth/service';
import { digestToken } from '@/server/auth/crypto';
import { referenceScope, canReferenceFile } from '@/server/files/access';
import { appendAudit, auditOperation } from '@/server/audit/writer';
import { StorageCoreError, type StorageHooks } from '@/server/storage/contracts';
import { AuthorizedStorageReader } from '@/server/storage/read';
import type { StorageTransport } from '@/server/storage/contracts';
export function fixtureIds(runId: string) { return { contextId: `s1-context-${runId}`, userId: `s1-user-${runId}`, taskId: `s1-task-${runId}`, memberId: `s1-member-${runId}`, sessionId: `s1-session-${runId}`, token: `synthetic-s1-token-${runId}` }; }
export async function createFixture(repo: RecordRepository, runId: string, clock: Clock) {
  const f = fixtureIds(runId), now = clock();
  await repo.transaction(async s => {
    await s.create('context', { id: f.contextId, contextId: null, data: { country: '합성 일본', retailer: '합성 리테일러', brand: '합성 브랜드', combinationKey: `storage-s1-${runId}` } });
    await s.create('user', { id: f.userId, contextId: null, data: { name: '합성 Storage 담당자', email: `${runId}@example.test`, normalizedEmail: `${runId}@example.test`, role: 'gsg', status: 'active', authVersion: 1, adminGrant: null } });
    await s.create('membership', { id: f.memberId, contextId: f.contextId, data: { userId: f.userId, role: 'operator', status: 'active', scope: 'synthetic', internalPriceAccess: false, activatedAt: now, suspendedAt: null } });
    await s.create('session', { id: f.sessionId, contextId: null, data: { userId: f.userId, tokenHash: digestToken(f.token), csrfToken: 'synthetic-csrf', authVersion: 1, expiresAt: new Date(Date.parse(now) + 3 * 86400_000).toISOString(), revokedAt: null } });
    await s.create('task', { id: f.taskId, contextId: f.contextId, data: { title: '합성 Storage 경계 검증', category: 'spot', assigneeId: f.userId, ownerId: f.userId, authorId: f.userId, description: 'synthetic only', status: 'requested', deadline: null, nextAction: '', productIds: [], notes: [] } });
  });
}
export function adapters(repo: RecordRepository, runId: string, clock: Clock, fault?: () => void) {
  const f = fixtureIds(runId), identity = new IdentityService(repo, clock);
  const hooks: StorageHooks<string, string> = {
    async authorize(s, token, binding) {
      if (binding.contextId !== f.contextId || binding.owner.purpose !== 'task_reference' || binding.owner.taskId !== f.taskId) throw new StorageCoreError('NOT_FOUND');
      const p = await identity.principal(s, token);
      await referenceScope(s, p, binding.owner.taskId, clock, true);
      return { actorId: p.user.id };
    },
    async validate(_input, bytes) { return bytes.length.toString(); },
    async commit(s, { grant, object, descriptor }) {
      const p = await identity.principal(s, f.token), id = randomUUID(), receiptId = randomUUID();
      return auditOperation(s, receiptId, async () => {
        await s.create('fileVersion', { id, contextId: f.contextId, data: { taskId: f.taskId, owner: { kind: 'task', taskId: f.taskId }, backend: { kind: 'supabase', objectId: object.id }, storageKey: object.id, originalName: descriptor.originalName, mime: descriptor.mime, bytes: descriptor.bytes, sha256: descriptor.sha256, preview: descriptor.preview, visibility: grant.data.identity.visibility, uploaderId: p.user.id } });
        await s.create('commandReceipt', { id: receiptId, contextId: f.contextId, data: { key: receiptId, command: 'storage-app-fixture', actorId: p.user.id, bodyHash: grant.data.identity.bodyHash, result: { ids: [id] } } });
        const audit = await appendAudit(s, p, clock, f.contextId, 'task.file_uploaded', f.taskId, {}, { fileVersionIds: [id] });
        fault?.();
        return { record: { kind: 'fileVersion', id }, receiptId, auditIds: [audit.id] };
      });
    },
  };
  const reader = (transport: () => StorageTransport) => new AuthorizedStorageReader(repo, transport, async (s: UnitOfWork, token: string, object) => {
    const p = await identity.principal(s, token), grant = await s.get('storageUploadGrant', object.data.grantId);
    if (!grant?.data.result || grant.data.result.record.kind !== 'fileVersion') throw new StorageCoreError('NOT_FOUND');
    const file = await s.get('fileVersion', grant.data.result.record.id);
    if (!file || file.data.backend?.objectId !== object.id || file.data.taskId !== f.taskId || p.user.data.role !== 'gsg') throw new StorageCoreError('NOT_FOUND');
    const target = await referenceScope(s, p, f.taskId, clock);
    await canReferenceFile(s, p, file, target, clock);
    // GSG original-task inclusion is explicitly allowed by FileService; this fixture uses that exact case.
    const task = (await s.get('task', f.taskId))!, member = (await s.get('membership', f.memberId))!;
    return { authorizationStamp: `${p.user.revision}:${p.session.revision}:${task.revision}:${member.revision}:${file.revision}` };
  });
  return { hooks, reader };
}
