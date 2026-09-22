import 'server-only';
import type { UnitOfWork } from '@/domain/records';
import { STORAGE_LIMITS } from '@/domain/storage/types';
import { canonical, digest } from '@/domain/storage/validate';
import { INPUT_LIMITS } from '@/domain/ai-input/types';
import type { IdentityService } from '@/server/auth/service';
import { fail } from '@/server/auth/errors';
import { AuthorizedStorageReader } from '@/server/storage/read';
import type { StorageTransport } from '@/server/storage/contracts';
import { consumerStorage } from '@/server/imports/storage-runtime';
import { resolveVersion } from './access';
/** Exact input version inclusion plus original + submitted-reference ACL are resolved together. */
export class VersionSourceStorage {
  constructor(readonly identity: IdentityService, readonly transport: () => StorageTransport = consumerStorage) {}
  private async resolve(s: UnitOfWork, token: string | undefined, inputId: string, versionId: string, index: number) {
    const p = await this.identity.principal(s, token), r = await resolveVersion(s, p, inputId, versionId, this.identity.clock);
    if (!Number.isSafeInteger(index) || index < 0 || index > 3 || r.content.kind === 'text') fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
    const ref = r.content.sources[index]; if (!ref) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
    const asset = ref.kind === 'upload' ? await s.get('aiAsset', ref.assetId) : null, file = ref.kind === 'submission_file' ? await s.get('fileVersion', ref.fileVersionId) : null;
    const row = asset ?? file; if (!row || row.contextId !== r.input.contextId || !row.data.backend) fail('STORAGE_UNAVAILABLE', 503, '원본 저장 위치를 확인할 수 없습니다.');
    const name = asset ? asset.data.filename : file!.data.originalName;
    const metadata = { id: row.id, name, mime: row.data.mime, bytes: row.data.bytes, sha256: row.data.sha256, etag: `"${row.data.sha256}"`, chunkBytes: STORAGE_LIMITS.chunkBytes, downloadUrl: `/api/ai-input/${encodeURIComponent(inputId)}/sources/${index}?versionId=${encodeURIComponent(versionId)}` };
    if (typeof name !== 'string' || typeof metadata.mime !== 'string' || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > INPUT_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(metadata.sha256)) fail('STORAGE_UNAVAILABLE', 503, '원본 정보를 확인할 수 없습니다.');
    return { row, metadata, objectId: row.data.backend.objectId, stamp: digest(canonical({ actor: p.user.id, authVersion: p.user.data.authVersion, session: p.session.id, input: r.input.id, inputRevision: r.input.revision, version: r.version.id, hash: r.version.data.contentHash, source: row.id, revision: row.revision, index })) };
  }
  private reader(inputId: string, versionId: string, index: number) {
    return new AuthorizedStorageReader(this.identity.repo, this.transport, async (s, token: string | undefined, object) => {
      const r = await this.resolve(s, token, inputId, versionId, index);
      if (r.objectId !== object.id || r.row.contextId !== object.contextId || r.metadata.bytes !== object.data.descriptor.bytes || r.metadata.sha256 !== object.data.descriptor.sha256) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      return { authorizationStamp: r.stamp };
    });
  }
  async metadata(token: string | undefined, inputId: string, versionId: string, index: number) { return (await this.identity.repo.transaction(s => this.resolve(s, token, inputId, versionId, index))).metadata; }
  async snapshot(token: string | undefined, inputId: string, versionId: string, index: number) {
    const r = await this.identity.repo.transaction(s => this.resolve(s, token, inputId, versionId, index));
    return { metadata: r.metadata, bytes: await this.reader(inputId, versionId, index).snapshot(token, r.objectId, INPUT_LIMITS.fileBytes) };
  }
  async chunk(token: string | undefined, inputId: string, versionId: string, index: number, start: number, end: number) {
    const r = await this.identity.repo.transaction(s => this.resolve(s, token, inputId, versionId, index));
    return { metadata: r.metadata, bytes: await this.reader(inputId, versionId, index).chunk(token, r.objectId, start, end) };
  }
}
