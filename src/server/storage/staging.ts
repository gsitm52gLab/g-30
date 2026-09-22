import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Clock, RecordRepository, StoredRecord, UnitOfWork } from '@/domain/records';
import { systemClock } from '@/domain/records';
import { STORAGE_LIMITS, type ImportStageData } from '@/domain/storage/types';
import { digest, stageShape } from '@/domain/storage/validate';
import { StorageCoreError } from './contracts';
export type StageAuthorization<C> = (s: UnitOfWork, credentials: C, contextId: string, stage: StoredRecord<'importStage'> | null) => Promise<{ actorId: string }>;
export interface NewImportStage {
  contextId: string; stageType: 'source' | 'preview'; sourceHash: string;
  sourceObjectId: string | null; sourceStageId: string | null; payload: unknown;
}
/** Same-UoW creation helper for the upload commit callback. No filesystem fallback. */
export async function createImportStage(s: UnitOfWork, actorId: string, input: NewImportStage, now: number) {
  let payload: string;
  try { payload = JSON.stringify(input.payload); } catch { throw new StorageCoreError('INVALID_INPUT'); }
  if (typeof payload !== 'string' || Buffer.byteLength(payload) > STORAGE_LIMITS.importBytes) throw new StorageCoreError('INVALID_INPUT');
  const data: ImportStageData = { stageType: input.stageType, actorId, sourceObjectId: input.sourceObjectId, sourceStageId: input.sourceStageId, sourceHash: input.sourceHash, createdAt: now,
    expiresAt: now + (input.stageType === 'source' ? STORAGE_LIMITS.sourceMs : STORAGE_LIMITS.previewMs), payload, payloadHash: digest(payload), state: 'active' };
  stageShape(data);
  if ((await s.list('importStage')).filter(row => row.data.actorId === actorId && row.data.state === 'active' && row.data.expiresAt > now).length >= STORAGE_LIMITS.importCount) throw new StorageCoreError('STAGING_LIMIT');
  return s.create('importStage', { id: randomUUID(), contextId: input.contextId, data });
}
export class SharedImportStaging<C> {
  constructor(private repository: RecordRepository, private authorize: StageAuthorization<C>, private clock: Clock = systemClock) {}
  async put(credentials: C, input: NewImportStage) {
    return this.repository.transaction(async s => {
      const p = await this.authorize(s, credentials, input.contextId, null);
      return createImportStage(s, p.actorId, input, Date.parse(this.clock()));
    });
  }
  async get(credentials: C, id: string): Promise<unknown> {
    return this.repository.transaction(async s => {
      const row = await s.get('importStage', id);
      if (!row || !row.contextId) throw new StorageCoreError('NOT_FOUND');
      const p = await this.authorize(s, credentials, row.contextId, row);
      if (p.actorId !== row.data.actorId) throw new StorageCoreError('NOT_FOUND');
      stageShape(row.data);
      if (row.data.state !== 'active' || row.data.expiresAt <= Date.parse(this.clock()) || row.data.payload === null) throw new StorageCoreError('EXPIRED');
      return JSON.parse(row.data.payload) as unknown;
    });
  }
  /** Invoked by an existing authorized import apply inside its own all-or-nothing transaction. */
  async consume(s: UnitOfWork, credentials: C, id: string) {
    const row = await s.get('importStage', id);
    if (!row || !row.contextId) throw new StorageCoreError('NOT_FOUND');
    const p = await this.authorize(s, credentials, row.contextId, row);
    if (p.actorId !== row.data.actorId) throw new StorageCoreError('NOT_FOUND');
    if (row.data.state !== 'active' || row.data.expiresAt <= Date.parse(this.clock())) throw new StorageCoreError('EXPIRED');
    return s.update('importStage', id, row.revision, { ...row.data, state: 'consumed' });
  }
  async expire(s: UnitOfWork, credentials: C, id: string) {
    const row = await s.get('importStage', id);
    if (!row || !row.contextId) throw new StorageCoreError('NOT_FOUND');
    const p = await this.authorize(s, credentials, row.contextId, row);
    if (p.actorId !== row.data.actorId) throw new StorageCoreError('NOT_FOUND');
    if (row.data.expiresAt >= Date.parse(this.clock()) || row.data.state === 'expired') throw new StorageCoreError('CONFLICT');
    return s.update('importStage', id, row.revision, { ...row.data, state: 'expired', payload: null });
  }
}
