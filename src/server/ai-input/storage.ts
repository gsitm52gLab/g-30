import 'server-only';
import { randomUUID } from 'node:crypto';
import type { UnitOfWork, StoredRecord } from '@/domain/records';
import type { UploadInput } from '@/domain/storage/types';
import { canonical, digest } from '@/domain/storage/validate';
import { preflight } from '@/domain/ai-input/preflight';
import { INPUT_LIMITS } from '@/domain/ai-input/types';
import type { IdentityService } from '@/server/auth/service';
import { fail } from '@/server/auth/errors';
import { StorageCore } from '@/server/storage/core';
import { AuthorizedStorageReader } from '@/server/storage/read';
import type { StorageTransport } from '@/server/storage/contracts';
import { consumerStorage } from '@/server/imports/storage-runtime';
import { receipt, audit } from '@/server/products/store';
import { assetAccess, contextAccess } from './access';
export type AssetReadCheck = (s: UnitOfWork, row: StoredRecord<'aiAsset'>) => Promise<string>;
export function validateAsset(input: Pick<UploadInput, 'contextId' | 'originalName' | 'declaredMime'>, bytes: Buffer) {
  const sourceId = 'upload-validation', sha256 = digest(bytes), source = { sourceId, versionId: sourceId, contextId: input.contextId, sha256, filename: input.originalName, mime: input.declaredMime, bytes };
  const admitted = preflight({ scope: { classification: 'general_cosmetic', language: 'ja', media: 'pop', use: 'local upload validation' }, ...(source.mime === 'application/pdf' ? { kind: 'pdf', source, selectedPages: [1] } : { kind: 'images', sources: [source] }) });
  if (!admitted.ok || bytes.length > INPUT_LIMITS.fileBytes) fail('VALIDATION', 422, '파일 형식, 크기 또는 내용이 입력 한도에 맞지 않습니다.');
}
export class AiAssetStorage {
  constructor(readonly identity: IdentityService, readonly transport: () => StorageTransport = consumerStorage) {}
  private core(token: string | undefined) {
    const i = this.identity;
    return new StorageCore(i.repo, this.transport, {
      authorize: async (s, credentials: string | undefined, binding) => {
        if (binding.owner.purpose !== 'ai_asset') fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
        const p = await i.principal(s, credentials);
        await contextAccess(s, p, binding.contextId, i.clock, binding.visibility === 'internal' ? 'staff' : 'context');
        return { actorId: p.user.id };
      },
      validate: async (input, bytes) => { validateAsset(input, bytes); },
      commit: async (s, { grant, object, descriptor }) => {
        const p = await i.principal(s, token), g = grant.data.identity, visibility = g.visibility === 'internal' ? 'staff' as const : 'context' as const;
        const input = { idempotencyKey: g.clientItemId, filename: descriptor.originalName, mime: descriptor.mime, sha256: descriptor.sha256, visibility }, auditIds: string[] = [];
        const result = await receipt(s, p, g.contextId, 'ai.upload', input, async () => {
          const assetId = randomUUID();
          await s.create('aiAsset', { id: assetId, contextId: g.contextId, data: { createdBy: p.user.id, visibility, filename: descriptor.originalName, mime: descriptor.mime, bytes: descriptor.bytes, sha256: descriptor.sha256, storageKey: assetId, backend: { kind: 'supabase', objectId: object.id } } });
          const event = await audit(s, p, i.clock, g.contextId, 'ai.upload', assetId, {}, { visibility }, { subject: { kind: 'aiAsset', id: assetId }, references: [{ kind: 'aiAsset', id: assetId, role: 'after' }] });
          auditIds.push(event.id); return { ids: [assetId] };
        });
        const key = digest(`${p.user.id}:${g.contextId}:ai.upload:${g.clientItemId}`), committed = (await s.list('commandReceipt')).find(r => r.data.key === key);
        if (!committed || !auditIds.length) fail('CONFLICT', 409, '이미 저장한 업로드입니다. 기존 자료를 선택해 주세요.');
        return { record: { kind: 'aiAsset' as const, id: result.ids[0] }, receiptId: committed.id, auditIds };
      },
    }, i.clock);
  }
  issue(token: string | undefined, input: UploadInput) { return this.core(token).issue(token, input); }
  status(token: string | undefined, id: string) { return this.core(token).status(token, id); }
  finalize(token: string | undefined, id: string) { return this.core(token).finalize(token, id); }
  async metadata(token: string | undefined, assetId: string, extra?: AssetReadCheck) {
    return this.identity.repo.transaction(async s => {
      const p = await this.identity.principal(s, token), row = await s.get('aiAsset', assetId);
      if (!row?.contextId) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      await assetAccess(s, p, row.id, row.contextId, this.identity.clock); await extra?.(s, row); return row;
    });
  }
  private reader(assetId: string, extra?: AssetReadCheck) {
    return new AuthorizedStorageReader(this.identity.repo, this.transport, async (s, token: string | undefined, object) => {
      const p = await this.identity.principal(s, token), row = await s.get('aiAsset', assetId);
      if (!row?.contextId || row.data.backend?.objectId !== object.id || object.contextId !== row.contextId || object.data.binding.owner.purpose !== 'ai_asset' || object.data.descriptor.sha256 !== row.data.sha256 || object.data.descriptor.bytes !== row.data.bytes) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      await assetAccess(s, p, row.id, row.contextId, this.identity.clock);
      const parent = await extra?.(s, row);
      return { authorizationStamp: digest(canonical({ actor: p.user.id, authVersion: p.user.data.authVersion, session: p.session.id, asset: row.id, revision: row.revision, parent: parent ?? null })) };
    });
  }
  async snapshot(token: string | undefined, assetId: string, extra?: AssetReadCheck) {
    const row = await this.metadata(token, assetId, extra);
    if (!row.data.backend) fail('STORAGE_UNAVAILABLE', 503, '원본 파일의 저장 위치를 확인할 수 없습니다.');
    return { row, bytes: await this.reader(assetId, extra).snapshot(token, row.data.backend.objectId, INPUT_LIMITS.fileBytes) };
  }
  async chunk(token: string | undefined, assetId: string, start: number, end: number, extra?: AssetReadCheck) {
    const row = await this.metadata(token, assetId, extra);
    if (!row.data.backend) fail('STORAGE_UNAVAILABLE', 503, '원본 파일의 저장 위치를 확인할 수 없습니다.');
    return { row, bytes: await this.reader(assetId, extra).chunk(token, row.data.backend.objectId, start, end) };
  }
}
