import 'server-only';
import type { RecordRepository, StoredRecord, UnitOfWork } from '@/domain/records';
import { STORAGE_LIMITS } from '@/domain/storage/types';
import { canonical, descriptor, digest } from '@/domain/storage/validate';
import { StorageCoreError, type StorageTransport } from './contracts';
/** The feature resolver must check identity, source AND reference ACL and exact immutable inclusion. */
export type StorageReadResolver<C> = (s: UnitOfWork, credentials: C, object: StoredRecord<'storageObject'>) => Promise<{ authorizationStamp: string }>;
export class AuthorizedStorageReader<C> {
  constructor(private repository: RecordRepository, private transport: () => StorageTransport, private resolve: StorageReadResolver<C>) {}
  private async authorized(credentials: C, id: string) {
    return this.repository.transaction(async s => {
      const row = await s.get('storageObject', id);
      if (!row) throw new StorageCoreError('NOT_FOUND');
      const authority = await this.resolve(s, credentials, row);
      if (typeof authority.authorizationStamp !== 'string' || !authority.authorizationStamp || authority.authorizationStamp.length > 512) throw new StorageCoreError('REJECTED');
      return { descriptor: descriptor(row.data.descriptor, 'final'), revision: row.revision, stamp: authority.authorizationStamp };
    });
  }
  async chunk(credentials: C, objectId: string, start: number, end: number): Promise<Buffer> {
    const before = await this.authorized(credentials, objectId);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= before.descriptor.bytes || end - start + 1 > STORAGE_LIMITS.chunkBytes) throw new StorageCoreError('INVALID_INPUT');
    const bytes = await this.transport().readRange(before.descriptor, start, end);
    const after = await this.authorized(credentials, objectId);
    if (canonical(before) !== canonical(after) || bytes.length !== end - start + 1) throw new StorageCoreError('CONFLICT');
    return bytes;
  }
  /** Internal parser/worker consumption only. Never convert this into a large public Response. */
  async snapshot(credentials: C, objectId: string, maximumBytes = STORAGE_LIMITS.generalBytes): Promise<Buffer> {
    const first = await this.authorized(credentials, objectId);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > STORAGE_LIMITS.generalBytes || first.descriptor.bytes > maximumBytes) throw new StorageCoreError('INVALID_INPUT');
    const parts: Buffer[] = [];
    for (let start = 0; start < first.descriptor.bytes; start += STORAGE_LIMITS.chunkBytes)
      parts.push(await this.chunk(credentials, objectId, start, Math.min(first.descriptor.bytes - 1, start + STORAGE_LIMITS.chunkBytes - 1)));
    const after = await this.authorized(credentials, objectId), bytes = Buffer.concat(parts);
    if (canonical(first) !== canonical(after) || digest(bytes) !== first.descriptor.sha256) throw new StorageCoreError('CONFLICT');
    return bytes;
  }
}
