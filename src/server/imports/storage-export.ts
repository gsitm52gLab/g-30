import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ImportExportData } from '@/domain/storage/types';
import { STORAGE_LIMITS } from '@/domain/storage/types';
import { canonical, digest, exportShape } from '@/domain/storage/validate';
import type { IdentityService } from '@/server/auth/service';
import type { SupabasePrivateStorage } from '@/server/storage/supabase';
import { fail } from '@/server/auth/errors';
import { audit } from '@/server/products/store';
import { consumerStorage } from './storage-runtime';
import { importAccess } from './service';
type ExportTransport = Pick<SupabasePrivateStorage, 'allocateFinalKey' | 'createGeneratedPart' | 'readRange'>;
/** Private diagnostics only: this object must never be serialized in an HTTP error. */
export class ExportPublicationError extends Error {
  constructor(readonly exportId: string, readonly orphanKeys: string[]) { super('Export publication did not complete.'); }
}
export class ImportExports {
  constructor(readonly identity: IdentityService, readonly transport: () => ExportTransport = consumerStorage) {}
  async publish(token: string | undefined, contextId: string, includeInternal: boolean, bytes: Buffer) {
    const actorId = await this.identity.repo.transaction(async s => { const p = await this.identity.principal(s, token); await importAccess(s, p, contextId, this.identity.clock, false, includeInternal); return p.user.id; });
    const exportId = randomUUID(), filename = `gs-hale-export-${exportId}.xlsx`, parts: ImportExportData['parts'] = [], transport = this.transport();
    const orphanKeys = Array.from({ length: Math.ceil(bytes.length / STORAGE_LIMITS.chunkBytes) }, () => transport.allocateFinalKey());
    const diagnostic = (phase: 'allocated' | 'published' | 'recovered' | 'unknown') => console.info(JSON.stringify({ event: 'import_export_storage', exportId, phase, objectIds: orphanKeys.map(key => key.split('/').at(-1)) }));
    diagnostic('allocated'); // Private, best effort; this is not a durable recovery journal.
    try {
      for (let start = 0; start < bytes.length; start += STORAGE_LIMITS.chunkBytes) {
        await this.identity.repo.transaction(async s => { const p = await this.identity.principal(s, token); if (p.user.id !== actorId) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.'); await importAccess(s, p, contextId, this.identity.clock, false, includeInternal); });
        const key = orphanKeys[start / STORAGE_LIMITS.chunkBytes], part = bytes.subarray(start, Math.min(start + STORAGE_LIMITS.chunkBytes, bytes.length));
        parts.push({ start, descriptor: await transport.createGeneratedPart({ key, bytes: part, filename, sha256: digest(part) }) });
      }
      const row = await this.identity.repo.transaction(async s => {
        const p = await this.identity.principal(s, token); if (p.user.id !== actorId) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
        await importAccess(s, p, contextId, this.identity.clock, false, includeInternal);
        const row = await s.create('importExport', { id: exportId, contextId, data: { actorId, includeInternal, filename, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', createdAt: Date.parse(this.identity.clock()), totalBytes: bytes.length, sha256: digest(bytes), parts } });
        await audit(s, p, this.identity.clock, contextId, 'import.export', row.id, {}, { count: parts.length }, { subject: { kind: 'importExport', id: row.id }, sensitivity: includeInternal ? 'internal_price' : 'standard', references: [{ kind: 'importExport', id: row.id, role: 'source' }] });
        return row;
      });
      diagnostic('published'); return this.dto(row.id, row.data);
    } catch {
      // A failed COMMIT response can still have persisted the immutable manifest. Never regenerate.
      try {
        const recovered = await this.authorized(token, exportId);
        if (recovered.row.contextId === contextId && recovered.row.data.totalBytes === bytes.length && recovered.row.data.sha256 === digest(bytes)) { diagnostic('recovered'); return this.dto(exportId, recovered.row.data); }
      } catch { /* missing, inaccessible or unknown remains a failed publication */ }
      diagnostic('unknown'); throw new ExportPublicationError(exportId, orphanKeys);
    }
  }
  private dto(id: string, v: ImportExportData) { return { id, name: v.filename, mime: v.mime, bytes: v.totalBytes, sha256: v.sha256, etag: `"${v.sha256}"`, chunkBytes: STORAGE_LIMITS.chunkBytes, downloadUrl: `/api/imports/exports/${encodeURIComponent(id)}` }; }
  private async authorized(token: string | undefined, id: string) {
    return this.identity.repo.transaction(async s => {
      const p = await this.identity.principal(s, token), row = await s.get('importExport', id);
      if (!row?.contextId || row.data.actorId !== p.user.id) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      exportShape(row.data); await importAccess(s, p, row.contextId, this.identity.clock, false, row.data.includeInternal);
      return { row, stamp: digest(canonical({ actor: p.user.id, authVersion: p.user.data.authVersion, session: p.session.id, revision: row.revision, manifest: row.data })) };
    });
  }
  async metadata(token: string | undefined, id: string) { const { row } = await this.authorized(token, id); return this.dto(id, row.data); }
  async chunk(token: string | undefined, id: string, start: number, end: number) {
    const before = await this.authorized(token, id), v = before.row.data;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= v.totalBytes || end - start + 1 > STORAGE_LIMITS.chunkBytes) fail('VALIDATION', 416, '파일 범위를 확인해 주세요.');
    const chunks: Buffer[] = [];
    for (const part of v.parts) {
      const last = part.start + part.descriptor.bytes - 1;
      if (last < start || part.start > end) continue;
      if ((await this.authorized(token, id)).stamp !== before.stamp) fail('CONFLICT', 409, '파일이 변경되었습니다.');
      chunks.push(await this.transport().readRange(part.descriptor, Math.max(start, part.start) - part.start, Math.min(end, last) - part.start));
      if ((await this.authorized(token, id)).stamp !== before.stamp) fail('CONFLICT', 409, '파일이 변경되었습니다.');
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== end - start + 1) fail('STORAGE_UNAVAILABLE', 503, '파일 무결성을 확인할 수 없습니다.');
    return { bytes, metadata: this.dto(id, v) };
  }
}
