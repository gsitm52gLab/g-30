import { ImportStorage, previewStage } from './storage';
import type { StorageTransport } from '@/server/storage/contracts';
import { asyncMap } from "@/domain/async-collections";
import { batchDTO } from './projection';
import { previewInput } from '@/domain/imports/validate';
import { createHash } from 'node:crypto';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { IdentityService } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { object, str } from '@/domain/tasks/validate';
import { importFields } from '@/domain/imports/fields';
import { IMPORT_SCHEMA, importLimits, type ParsedWorkbook, type PreviewInput, type ImportPreview, type ImportBatchData } from '@/domain/imports/types';
import { sharedCommonNotice, blankCommon, blankContext } from '@/domain/products/types';
import { resolveProduct, productContextScope, visibleProductRelations } from '@/server/products/access';
import { commonDTO, contextDTO, retailDTO, internalDTO } from '@/server/products/projection';
import { createProduct, updateProductCommon, updateProductContext, writeRetailPrice, writeInternalPrice } from '@/server/products/mutations';
import { authorize, decide } from '@/server/policy/policy';
import { newId, receipt, fresh, uniqueCode, audit } from '@/server/products/store';
import { ImportStaging } from './staging';
import { inspectWorkbook } from './parser';
import { planRows, checkMapping, type PlannedRow } from './plan';
import { productValues, workbookBytes } from './workbook';
export interface SourceStage {
    actorId: string;
    contextId: string;
    name: string;
    sourceHash: string;
    createdAt: string;
    workbook: ParsedWorkbook;
}
export interface PreviewStage {
    actorId: string;
    contextId: string;
    sourceHash: string;
    sourceName: string;
    createdAt: string;
    expiresAt: string;
    input: PreviewInput;
    sheetName: string;
    privatePrice: boolean;
    plans: PlannedRow[];
    warnings: string[];
}
export async function importAccess(s: UnitOfWork, p: Principal, contextId: string, clock: Clock, write = true, privatePrice = false) {
    (await authorize(s, p, write ? 'product.edit' : 'product.read', productContextScope(contextId, 'import'), clock));
    if (privatePrice)
        (await authorize(s, p, 'price.read', { ...productContextScope(contextId, 'import'), requiresInternalPrice: true }, clock));
    return (await decide(s, p, 'price.read', { ...productContextScope(contextId, 'import'), requiresInternalPrice: true }, clock)).allowed;
}
function previewDTO(id: string, v: PreviewStage, page: number): ImportPreview {
    if (!Number.isSafeInteger(page) || page < 1)
        fail('VALIDATION', 422, '페이지를 확인해 주세요.');
    const fields = new Set(v.input.mapping.map(m => m.field).filter(key => importFields.some(f => f.key === key && (v.privatePrice || !f.privatePrice))));
    const errorRows = v.plans.filter(r => r.preview.errors.length).length, counts = { new: 0, update: 0, skip: 0 };
    for (const plan of v.plans)
        counts[plan.preview.action]++;
    return { id, contextId: v.contextId, sourceHash: v.sourceHash, schema: IMPORT_SCHEMA, createdAt: v.createdAt, expiresAt: v.expiresAt, sheetId: v.input.sheetId, sheetName: v.sheetName, headerRow: v.input.headerRow, mapping: v.input.mapping.map(m => ({ column: m.column, field: m.field })), totalRows: v.plans.length, errorRows, canApply: errorRows === 0, page, pageSize: importLimits.pageSize, rows: v.plans.slice((page - 1) * 100, page * 100).map(({preview:r}) => ({ row:r.row, action:r.action, raw:Object.fromEntries(Object.entries(r.raw).filter(([key])=>fields.has(key))), normalized:Object.fromEntries(Object.entries(r.normalized).filter(([key])=>fields.has(key))), errors:r.errors.map(e=>({code:e.code,message:e.message,column:e.column,field:e.field})), target:r.target ? {productId:r.target.productId,contextProductId:r.target.contextProductId,commonRevision:r.target.commonRevision,contextRevision:r.target.contextRevision,retailRevision:r.target.retailRevision,...v.privatePrice&&r.target.internalRevision!==undefined?{internalRevision:r.target.internalRevision}:{}} : null, visibleContexts:r.visibleContexts.map(c=>({id:c.id,country:c.country,retailer:c.retailer,brand:c.brand})) })), counts, sharedCommonNotice, warnings: v.warnings };
}
export class ImportService {
    constructor(public identity: IdentityService, public staging = new ImportStaging(), private fault?: (row: number) => void, private transport?: () => StorageTransport) { }
    get storage() { return new ImportStorage(this.identity, this.transport); }
    async source(token: string | undefined, sourceId: string) { const v = this.identity.repo.mode === 'supabase' ? await this.storage.source(token, sourceId) : await this.staging.get<SourceStage>(sourceId); await this.identity.repo.transaction(async s => { const p = await this.identity.principal(s, token); if (p.user.id !== v.actorId) unavailable(); await importAccess(s, p, v.contextId, this.clock); }); return { sourceId, sourceHash: v.sourceHash, contextId: v.contextId, sheets: v.workbook.sheets.map(s => ({ id: s.id, name: s.name, rowCount: s.rows.length, firstRows: s.rows.slice(0,20) })), omittedHiddenSheets: v.workbook.omittedHiddenSheets, notice: '숨겨진 시트는 선택 대상에서 제외합니다. 선택한 시트의 숨긴 행·열은 검증하고 표시합니다.' }; }
    get clock() { return this.identity.clock; }
    async configuration(token: string | undefined, contextId: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), privatePrice = (await importAccess(s, p, contextId, this.clock)); return { storageMode: this.identity.repo.mode, contextId, brandId: (await s.get('context', contextId))!.data.brandId!, schema: IMPORT_SCHEMA, fields: importFields.filter(f => privatePrice || !f.privatePrice).map(f => ({ ...f })), limits: importLimits, capabilities: { apply: true, internalPrice: privatePrice }, operationalWorkbookValidation: 'NOT_RUN' as const, operationalWorkbookNote: '현업 원본 Excel은 아직 제공되지 않았습니다. 표준 양식 검증과 별도로 확인합니다.' }; }); }
    async inspect(token: string | undefined, contextId: string, name: string, bytes: Buffer) {
        if (this.identity.repo.mode === 'supabase') fail('DIRECT_UPLOAD_REQUIRED', 422, '원본 업로드 경로를 사용해 주세요.');
        const actorId = await this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await importAccess(s, p, contextId, this.clock)); return p.user.id; });
        const workbook = await inspectWorkbook(name, bytes);
        await this.identity.repo.transaction(async (s) => (await importAccess(s, (await this.identity.principal(s, token)), contextId, this.clock)));
        const sourceHash = createHash('sha256').update(bytes).digest('hex'), sourceId = await this.staging.put<SourceStage>({ actorId, contextId, name: str(name, 255, true), sourceHash, createdAt: this.clock(), workbook });
        return { sourceId, sourceHash, contextId, sheets: workbook.sheets.map(s => ({ id: s.id, name: s.name, rowCount: s.rows.length, firstRows: s.rows.slice(0, 20) })), omittedHiddenSheets: workbook.omittedHiddenSheets, notice: '숨겨진 시트는 선택 대상에서 제외합니다. 선택한 시트의 숨긴 행·열은 검증하고 표시합니다.' };
    }
    async preview(token: string | undefined, inputValue: PreviewInput) {
        const input = previewInput(inputValue);
        const source = this.identity.repo.mode === 'supabase' ? await this.storage.source(token, input.sourceId) : await this.staging.get<SourceStage>(input.sourceId), sheet = source.workbook.sheets.find(s => s.id === input.sheetId);
        if (!sheet)
            fail('VALIDATION', 422, '표시된 시트를 선택해 주세요.');
        const stage = await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            if (p.user.id !== source.actorId)
                unavailable();
            const canPrice = (await importAccess(s, p, source.contextId, this.clock));
            checkMapping(input.mapping, canPrice);
            const privatePrice = input.mapping.some(m => m.field.startsWith('internal.')), plans = (await planRows(s, p, this.clock, source.contextId, sheet, input.headerRow, input.mapping, input.choices, privatePrice));
            const createdAt = this.clock();
            return { actorId: p.user.id, contextId: source.contextId, sourceHash: source.sourceHash, sourceName: source.name, createdAt, expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString(), input: { sourceId: input.sourceId, sheetId: input.sheetId, headerRow: input.headerRow, mapping: input.mapping.map(m => ({ column: m.column, field: m.field })), choices: input.choices.map(c => ({ row: c.row, action: c.action, clearFields: [...c.clearFields] })) }, sheetName: sheet.name, privatePrice, plans, warnings: [...source.workbook.omittedHiddenSheets ? ['숨겨진 시트는 반영하지 않습니다.'] : [], ...sheet.rows.some(r => r.hidden || r.cells.some(c => c.hidden)) ? ['숨겨진 행·열도 검증·반영 대상에 포함됩니다.'] : []] } satisfies PreviewStage;
        });
        const id = this.identity.repo.mode === 'supabase' ? await this.storage.putPreview(token, stage) : await this.staging.put(stage);
        return previewDTO(id, stage, 1);
    }
    async readPreview(token: string | undefined, id: string, page = 1) {
        const stage = previewStage(this.identity.repo.mode === 'supabase' ? await this.storage.preview(token, id) : await this.staging.get<PreviewStage>(id));
        await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            if (p.user.id !== stage.actorId)
                unavailable();
            (await importAccess(s, p, stage.contextId, this.clock, true, stage.privatePrice));
        });
        return previewDTO(id, stage, page);
    }
    async apply(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ['previewId', 'idempotencyKey']), previewId = str(v.previewId, 160, true);
        // A committed batch survives private staging expiry/cleanup. Fresh auth still precedes replay.
        const replay = await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), batch = (await s.list('importBatch')).find(b => b.data.previewId === previewId && b.data.actorId === p.user.id);
            if (!batch)
                return null;
            (await importAccess(s, p, batch.contextId!, this.clock, true, batch.data.includesInternalPrice));
            return (await receipt(s, p, batch.contextId!, 'import.apply', v, () => fail('CONFLICT', 409, '이미 반영한 미리보기입니다. 같은 재시도 키를 사용해 주세요.')));
        });
        if (replay)
            return replay;
        const stage = previewStage(this.identity.repo.mode === 'supabase' ? await this.storage.preview(token, previewId) : await this.staging.get<PreviewStage>(previewId));
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            if (p.user.id !== stage.actorId)
                unavailable();
            (await importAccess(s, p, stage.contextId, this.clock, true, stage.privatePrice));
            return (await receipt(s, p, stage.contextId, 'import.apply', v, async () => {
                if (stage.expiresAt <= this.clock())
                    fail('PREVIEW_EXPIRED', 409, '미리보기 유효 시간이 지났습니다. 입력 선택을 유지한 채 다시 미리보기를 생성해 주세요.');
                if (stage.plans.some(r => r.preview.errors.length))
                    fail('IMPORT_ERRORS', 422, '오류가 있는 행을 수정한 뒤 전체 파일을 다시 확인해 주세요.');
                if ((await s.list('importBatch', stage.contextId)).some(b => b.data.previewId === previewId))
                    fail('CONFLICT', 409, '이미 반영한 미리보기입니다.');
                if (this.identity.repo.mode === 'supabase') await this.storage.consume(s, token, previewId);
                // Check EVERY external revision before the first write; later CP revision changes are our own.
                for (const plan of stage.plans) {
                    const target = plan.preview.target;
                    if (target) {
                        const r = (await resolveProduct(s, p, stage.contextId, target.productId, this.clock, true));
                        fresh(r.product, target.commonRevision);
                        fresh(r.relation, target.contextRevision);
                        if (plan.changed.retail)
                            fresh((await s.list('retailPrice', stage.contextId)).find(x => x.data.contextProductId === r.relation.id) ?? null, target.retailRevision);
                        if (plan.changed.internal)
                            fresh((await s.list('internalPrice', stage.contextId)).find(x => x.data.contextProductId === r.relation.id) ?? null, target.internalRevision);
                        for (const cp of (await s.list('contextProduct')).filter(cp => cp.data.productId === r.product.id))
                            (await uniqueCode(s, cp.contextId!, plan.common.code, r.product.id));
                    }
                    else
                        (await uniqueCode(s, stage.contextId, plan.common.code));
                }
                const batchId = newId(), rows: ImportBatchData['rows'] = [], source = `Excel ${batchId} · ${stage.sourceHash}`;
                for (const plan of stage.plans) {
                    const target = plan.preview.target, versionIds: string[] = [];
                    let productId = target?.productId ?? null, contextProductId = target?.contextProductId ?? null;
                    if (plan.preview.action !== 'skip') {
                        if (!target) {
                            const made = (await createProduct(s, p, this.clock, stage.contextId, (await s.get('context', stage.contextId))!.data.brandId!, plan.common, plan.local, source));
                            productId = made.productId;
                            contextProductId = made.contextProductId;
                            const r = (await resolveProduct(s, p, stage.contextId, productId, this.clock, true));
                            versionIds.push(r.common.id, r.local.id);
                        }
                        else {
                            let r = (await resolveProduct(s, p, stage.contextId, target.productId, this.clock, true));
                            if (plan.changed.common)
                                versionIds.push((await updateProductCommon(s, p, this.clock, stage.contextId, target.productId, target.commonRevision, plan.common, r.common.data.archived, source)).id);
                            if (plan.changed.local) {
                                r = (await resolveProduct(s, p, stage.contextId, target.productId, this.clock, true));
                                versionIds.push((await updateProductContext(s, p, this.clock, stage.contextId, target.productId, r.relation.revision, plan.local, r.local.data.files, source)).id);
                            }
                        }
                        if (plan.retail)
                            versionIds.push((await writeRetailPrice(s, p, this.clock, stage.contextId, productId!, target?.retailRevision ?? 0, plan.retail, source)).id);
                        if (plan.internal)
                            versionIds.push((await writeInternalPrice(s, p, this.clock, stage.contextId, productId!, target?.internalRevision ?? 0, plan.internal, source)).id);
                        const auditEvent = (await s.create('domainEvent', { id: newId(), contextId: stage.contextId, data: { eventType: 'PRODUCT_IMPORTED', targetId: productId!, sourceVersionId: versionIds[0] ?? null, actorId: p.user.id, at: this.clock() } }));
                        (await audit(s, p, this.clock, stage.contextId, 'product.import', productId!, {}, { batchId, row: plan.preview.row, versionIds }, { sensitivity: stage.privatePrice ? 'internal_price' : 'standard', references: [{ kind: 'importBatch', id: batchId, role: 'source' }, { kind: 'domainEvent', id: auditEvent.id, role: 'source' }] }));
                    }
                    rows.push({ row: plan.preview.row, action: plan.preview.action, productId, contextProductId, versionIds, expected: target });
                    this.fault?.(plan.preview.row);
                }
                (await s.create('importBatch', { id: batchId, contextId: stage.contextId, data: { actorId: p.user.id, appliedAt: this.clock(), sourceHash: stage.sourceHash, sourceName: stage.sourceName, schema: IMPORT_SCHEMA, previewId, sheetId: stage.input.sheetId, sheetName: stage.sheetName, headerRow: stage.input.headerRow, mapping: stage.input.mapping, includesInternalPrice: stage.privatePrice, rows } }));
                (await audit(s, p, this.clock, stage.contextId, 'import.applied', batchId, {}, { sourceHash: stage.sourceHash, rows: rows.length, sourceName: stage.sourceName }, { sensitivity: stage.privatePrice ? 'internal_price' : 'standard', references: [{ kind: 'importBatch', id: batchId, role: 'after' }] }));
                return { ids: [batchId] };
            }));
        });
    }
    async batch(token: string | undefined, id: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), b = (await s.get('importBatch', id));
            if (!b?.contextId)
                unavailable();
            (await importAccess(s, p, b.contextId, this.clock, false, b.data.includesInternalPrice));
            return batchDTO(b);
        });
    }
    async workbook(token: string | undefined, contextId: string, kind: 'template' | 'export', includeInternal = false) {
        const data = await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            (await importAccess(s, p, contextId, this.clock, false, includeInternal));
            const fields = importFields.filter(f => includeInternal || !f.privatePrice), brandId = (await s.get('context', contextId))!.data.brandId!;
            const rows = kind === 'template' ? [productValues(contextId, brandId, blankCommon(), blankContext(), null, null)] : (await asyncMap((await visibleProductRelations(s, p, this.clock, contextId)), async (cp) => { const r = (await resolveProduct(s, p, contextId, cp.data.productId, this.clock)), retailRoot = (await s.list('retailPrice', contextId)).find(x => x.data.contextProductId === cp.id), retail = retailRoot?.data.currentVersionId ? (await s.get('retailPriceVersion', retailRoot.data.currentVersionId)) : null, internalRoot = includeInternal ? (await s.list('internalPrice', contextId)).find(x => x.data.contextProductId === cp.id) : null, internal = internalRoot?.data.currentVersionId ? (await s.get('internalPriceVersion', internalRoot.data.currentVersionId)) : null; return productValues(contextId, brandId, commonDTO(r.common.data.common), contextDTO(r.local.data.fields), retail ? retailDTO(retail.data.fields) : null, internal ? internalDTO(internal.data.fields) : null); }));
            return { fields, rows };
        });
        const bytes = await workbookBytes(data.fields, data.rows);
        await this.identity.repo.transaction(async (s) => (await importAccess(s, (await this.identity.principal(s, token)), contextId, this.clock, false, includeInternal)));
        return bytes;
    }
}
