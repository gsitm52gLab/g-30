import 'server-only';
import type { UnitOfWork } from '@/domain/records';
import type { UploadInput } from '@/domain/storage/types';
import { canonical, digest } from '@/domain/storage/validate';
import { previewInput } from '@/domain/imports/validate';
import { importLimits } from '@/domain/imports/types';
import { commonInput, contextInput, retailInput, internalInput } from '@/domain/products/validate';
import type { IdentityService } from '@/server/auth/service';
import { fail } from '@/server/auth/errors';
import { StorageCore } from '@/server/storage/core';
import { SharedImportStaging, createImportStage } from '@/server/storage/staging';
import type { StorageTransport } from '@/server/storage/contracts';
import { StorageCoreError } from '@/server/storage/contracts';
import { receipt, audit } from '@/server/products/store';
import { consumerStorage } from './storage-runtime';
import { importAccess, type SourceStage, type PreviewStage } from './service';
import { inspectWorkbook } from './parser';
const bad = (): never => fail('STORAGE_UNAVAILABLE', 503, '가져오기 자료의 무결성을 확인할 수 없습니다.');
function base(v: SourceStage | PreviewStage) {
  if (!v || typeof v !== 'object' || typeof v.actorId !== 'string' || typeof v.contextId !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceHash) || !Number.isFinite(Date.parse(v.createdAt))) bad();
}
export function sourceStage(value: unknown): SourceStage {
  const v = value as SourceStage; base(v);
  if (typeof v.name !== 'string' || v.name.length > 255 || !v.workbook || !Array.isArray(v.workbook.sheets) || v.workbook.sheets.length > importLimits.sheets || !Number.isSafeInteger(v.workbook.omittedHiddenSheets) || typeof v.workbook.date1904 !== 'boolean') bad();
  let cells = 0;
  for (const sheet of v.workbook.sheets) {
    if (!Number.isSafeInteger(sheet.id) || typeof sheet.name !== 'string' || sheet.hidden !== false || !Array.isArray(sheet.rows) || !Array.isArray(sheet.mergedRanges) || sheet.mergedRanges.some(x => typeof x !== 'string')) bad();
    for (const row of sheet.rows) {
      if (!Number.isSafeInteger(row.row) || row.row < 1 || typeof row.hidden !== 'boolean' || !Array.isArray(row.cells)) bad();
      for (const cell of row.cells) {
        if (++cells > importLimits.cells || !Number.isSafeInteger(cell.column) || cell.column < 1 || !['text','number','date','boolean','empty','error'].includes(cell.type) || typeof cell.text !== 'string' || cell.text.length > importLimits.text || typeof cell.hidden !== 'boolean' || cell.error !== null && typeof cell.error !== 'string') bad();
      }
    }
  }
  return { actorId:v.actorId,contextId:v.contextId,name:v.name,sourceHash:v.sourceHash,createdAt:v.createdAt,workbook:{omittedHiddenSheets:v.workbook.omittedHiddenSheets,date1904:v.workbook.date1904,sheets:v.workbook.sheets.map(sheet=>({id:sheet.id,name:sheet.name,hidden:false,mergedRanges:[...sheet.mergedRanges],rows:sheet.rows.map(row=>({row:row.row,hidden:row.hidden,cells:row.cells.map(cell=>({column:cell.column,type:cell.type,text:cell.text,error:cell.error,hidden:cell.hidden}))}))}))} };
}
export function previewStage(value: unknown): PreviewStage {
  const v = value as PreviewStage; base(v);
  try {
    if (typeof v.privatePrice !== 'boolean' || typeof v.sourceName !== 'string' || typeof v.sheetName !== 'string' || !Number.isFinite(Date.parse(v.expiresAt)) || !Array.isArray(v.plans) || v.plans.length > importLimits.rows || !Array.isArray(v.warnings) || v.warnings.some(x => typeof x !== 'string')) bad();
    const input = previewInput(v.input);
    if (canonical(input) !== canonical(v.input) || v.privatePrice !== input.mapping.some(m => m.field.startsWith('internal.'))) bad();
    for (const plan of v.plans) {
      const p = plan.preview;
      if (!p || !Number.isSafeInteger(p.row) || !['new','update','skip'].includes(p.action) || !Array.isArray(p.errors) || !Array.isArray(p.visibleContexts) || !p.raw || Object.values(p.raw).some(x => typeof x !== 'string') || !p.normalized || Object.values(p.normalized).some(x => x !== null && !['string','boolean'].includes(typeof x)) || !plan.changed || ['common','local','retail','internal'].some(k=>typeof plan.changed[k as keyof typeof plan.changed] !== 'boolean') || !v.privatePrice && (plan.internal !== null || plan.changed.internal)) bad();
      if (p.errors.some(e=>!e || typeof e.code !== 'string' || typeof e.message !== 'string' || e.column !== null && !Number.isSafeInteger(e.column) || e.field !== null && typeof e.field !== 'string') || p.visibleContexts.some(c=>!c || [c.id,c.country,c.retailer,c.brand].some(x=>typeof x !== 'string'))) bad();
      if (p.target && (typeof p.target.productId !== 'string' || typeof p.target.contextProductId !== 'string' || ![p.target.commonRevision,p.target.contextRevision,p.target.retailRevision,p.target.internalRevision ?? 0].every(x => Number.isSafeInteger(x) && x >= 0))) bad();
      if (!p.errors.length) { commonInput(plan.common); contextInput(plan.local); if (plan.retail) retailInput(plan.retail); if (plan.internal) internalInput(plan.internal); }
    }
  } catch { bad(); }
  return v;
}
export class ImportStorage {
  readonly staging: SharedImportStaging<string | undefined>;
  constructor(readonly identity: IdentityService, readonly transport: () => StorageTransport = consumerStorage) {
    this.staging = new SharedImportStaging(identity.repo, async (s, token, contextId, stage) => {
      const p = await identity.principal(s, token);
      if (stage && stage.data.actorId !== p.user.id) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      const internal = stage?.data.stageType === 'preview' && stage.data.payload !== null ? previewStage(JSON.parse(stage.data.payload)).privatePrice : false;
      await importAccess(s, p, contextId, identity.clock, true, internal); return { actorId: p.user.id };
    }, identity.clock);
  }
  private core(token: string | undefined) {
    const i = this.identity;
    return new StorageCore(i.repo, this.transport, {
      authorize: async (s, credentials: string | undefined, binding) => {
        if (binding.owner.purpose !== 'import_source' || binding.visibility !== 'internal') fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
        const p = await i.principal(s, credentials); await importAccess(s, p, binding.contextId, i.clock); return { actorId: p.user.id };
      },
      validate: async (input, bytes) => inspectWorkbook(input.originalName, bytes),
      commit: async (s, { grant, object, descriptor, validated }) => {
        const p = await i.principal(s, token), g = grant.data.identity, auditIds: string[] = [];
        const input = { idempotencyKey: g.clientItemId, sourceHash: descriptor.sha256, name: descriptor.originalName };
        const result = await receipt(s, p, g.contextId, 'import.source', input, async () => {
          const payload: SourceStage = { actorId: p.user.id, contextId: g.contextId, name: descriptor.originalName, sourceHash: descriptor.sha256, createdAt: i.clock(), workbook: validated };
          const stage = await createImportStage(s, p.user.id, { contextId: g.contextId, stageType: 'source', sourceHash: descriptor.sha256, sourceObjectId: object.id, sourceStageId: null, payload }, Date.parse(i.clock()));
          auditIds.push((await audit(s, p, i.clock, g.contextId, 'import.source', stage.id, {}, { sourceName: descriptor.originalName }, { subject: { kind: 'importStage', id: stage.id }, references: [{ kind: 'importStage', id: stage.id, role: 'source' }] })).id);
          return { ids: [stage.id] };
        });
        const key = digest(`${p.user.id}:${g.contextId}:import.source:${g.clientItemId}`), committed = (await s.list('commandReceipt')).find(r => r.data.key === key);
        if (!committed || !auditIds.length) fail('CONFLICT', 409, '이미 확인한 원본입니다. 기존 자료를 선택해 주세요.');
        return { record: { kind: 'importStage' as const, id: result.ids[0] }, receiptId: committed.id, auditIds };
      },
    }, i.clock);
  }
  issue(token: string | undefined, input: UploadInput) { return this.core(token).issue(token, input); }
  status(token: string | undefined, id: string) { return this.core(token).status(token, id); }
  finalize(token: string | undefined, id: string) { return this.core(token).finalize(token, id); }
  private async get(token: string | undefined, id: string, type: 'source' | 'preview') {
    try { return await this.staging.get(token, id); }
    catch (e) {
      if (e instanceof StorageCoreError) fail(e.code === 'EXPIRED' ? type === 'preview' ? 'PREVIEW_EXPIRED' : 'SOURCE_EXPIRED' : e.code, e.code === 'EXPIRED' && type === 'preview' ? 409 : e.status, e.code === 'EXPIRED' ? '유효 시간이 지났습니다. 원본 또는 미리보기를 다시 확인해 주세요.' : '가져오기 자료를 확인해 주세요.');
      throw e;
    }
  }
  async source(token: string | undefined, id: string) { const v = sourceStage(await this.get(token, id, 'source')); await this.match(token, id, v, 'source'); return v; }
  async preview(token: string | undefined, id: string) { const v = previewStage(await this.get(token, id, 'preview')); await this.match(token, id, v, 'preview'); return v; }
  private async match(token: string | undefined, id: string, payload: SourceStage | PreviewStage, type: 'source' | 'preview') {
    await this.identity.repo.transaction(async s => { const p = await this.identity.principal(s, token), row = await s.get('importStage', id); if (!row || row.contextId !== payload.contextId || row.data.actorId !== p.user.id || row.data.actorId !== payload.actorId || row.data.sourceHash !== payload.sourceHash || row.data.stageType !== type) bad(); });
  }
  async putPreview(token: string | undefined, stage: PreviewStage) {
    return this.identity.repo.transaction(async s => {
      const p = await this.identity.principal(s, token), source = await s.get('importStage', stage.input.sourceId);
      if (!source || source.data.stageType !== 'source' || source.data.actorId !== p.user.id || stage.actorId !== p.user.id || source.contextId !== stage.contextId || source.data.sourceHash !== stage.sourceHash) fail('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
      if (source.data.state !== 'active' || source.data.expiresAt <= Date.parse(this.identity.clock())) fail('SOURCE_EXPIRED', 410, '원본 유효 시간이 지났습니다. 다시 업로드해 주세요.');
      await importAccess(s, p, stage.contextId, this.identity.clock, true, stage.privatePrice);
      return (await createImportStage(s, p.user.id, { contextId: stage.contextId, stageType: 'preview', sourceHash: stage.sourceHash, sourceObjectId: null, sourceStageId: stage.input.sourceId, payload: stage }, Date.parse(this.identity.clock()))).id;
    });
  }
  consume(s: UnitOfWork, token: string | undefined, id: string) { return this.staging.consume(s, token, id); }
}
