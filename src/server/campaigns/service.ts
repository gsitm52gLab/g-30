import { asyncFlatMap, asyncForEach, asyncMap } from "@/domain/async-collections";
import { applyCampaignRequest, campaignPublicationBasis } from '@/server/tasks/campaign-request';
import { createHash } from 'node:crypto';
import type { UnitOfWork, StoredRecord } from '@/domain/records';
import type { Principal, IdentityService } from '@/server/auth/service';
import type { ServerVersion } from '@/domain/campaigns/types';
import * as parse from '@/domain/campaigns/validate';
import { object, str } from '@/domain/tasks/validate';
import { fail, unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { newId, receipt, fresh, audit } from '@/server/products/store';
import { manageCatalog, campaignTask, resolveCampaign, manager, provider } from './access';
import { publicContent, versionDTO, catalogDTO } from './projection';
import { validateDraft, sourceFiles, menuTarget, exactReference } from './targets';
import { campaignDetail, validateFollowup, readCampaignRemainder } from './read';
import * as safe from './stored';
export const campaignCommands = ['save_catalog', 'save', 'publish', 'participate', 'external', 'physical', 'followup'] as const;
export const campaignCommandKeys = ['command', 'contextId', 'taskId', 'campaignId', 'catalogId', 'expectedRevision', 'idempotencyKey', 'draft', 'campaignVersionId', 'response', 'selectedMenus', 'providedBy', 'note', 'menu', 'fact', 'physicalKey', 'followupKey', 'source', 'receivedBy', 'occurredAt'];
export class CampaignService {
    constructor(public identity: IdentityService, private fault?: (stage: string) => void) { }
    get clock() { return this.identity.clock; }
    private async event(s: UnitOfWork, p: Principal, row: StoredRecord<'campaign'>, kind: string, versionId: string) { (await s.create('domainEvent', { id: newId(), contextId: row.contextId, data: { eventType: kind, targetId: row.id, sourceVersionId: versionId, actorId: p.user.id, at: this.clock() } })); }
    private stamp(s: UnitOfWork, p: Principal, row: StoredRecord<'campaign'>, previousId: string | null): ServerVersion { return { sequence: safe.integer(row.data.sequence) + 1, previousId, recordedBy: p.user.id, recordedAt: this.clock() }; }
    private async bump(s: UnitOfWork, row: StoredRecord<'campaign'>, extra: Partial<StoredRecord<'campaign'>['data']> = {}) { (await s.update('campaign', row.id, row.revision, { ...row.data, sequence: safe.integer(row.data.sequence) + 1, publicRevision: safe.integer(row.data.publicRevision) + 1, ...extra })); }
    async list(token: string | undefined, contextId: string, taskId?: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await authorize(s, p, 'context.read', contextResource(contextId), this.clock)); if (taskId) {
        const t = (await campaignTask(s, p, taskId, this.clock));
        if (t.contextId !== contextId)
            unavailable();
    } const items = (await asyncFlatMap((await s.list('campaign', contextId)).filter(r => !taskId || r.data.taskId === taskId), async (r) => { let manage; try {
        (await campaignTask(s, p, r.data.taskId, this.clock));
        manage = (await manager(s, p, r.data.taskId, this.clock));
    }
    catch {
        return [];
    } const v = r.data.currentVersionId ? (await s.get('campaignVersion', r.data.currentVersionId)) : null; if (!v && !manage)
        return []; const pub = v ? (await versionDTO(s, p, v, this.clock)) : null; return [{ id: r.id, taskId: r.data.taskId, title: manage ? safe.draft(r.data.draft).title : pub!.title, revision: manage ? r.revision : safe.integer(r.data.publicRevision), currentVersionId: pub?.id ?? null, recordedAt: pub?.recordedAt ?? null, state: pub ? 'published' as const : 'draft' as const }]; })); return { contextId, items, total: items.length }; }); }
    async detail(token: string | undefined, id: string, versionId?: string) { return this.identity.repo.transaction(async (s) => (await campaignDetail(s, (await this.identity.principal(s, token)), id, this.clock, versionId))); }
    async preview(token: string | undefined, id: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), { row, task } = (await resolveCampaign(s, p, id, this.clock, 'manage')), draft = safe.draft(row.data.draft); (await validateDraft(s, p, task, draft, this.clock)); return publicContent(draft); }); }
    async catalogs(token: string | undefined, contextId: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await manageCatalog(s, p, contextId, this.clock)); return { contextId, items: (await asyncMap((await s.list('campaignCatalog', contextId)), async (r) => ({ id: r.id, revision: r.revision, currentVersionId: r.data.currentVersionId, versions: (await asyncMap((await s.list('campaignCatalogVersion', contextId)).filter(v => v.data.catalogId === r.id).sort((a, b) => b.data.sequence - a.data.sequence), async (v) => (await catalogDTO(s, p, v, this.clock)))) }))) }; }); }
    async remainder(token: string | undefined, taskId: string) { return this.identity.repo.transaction(async (s) => (await readCampaignRemainder(s, (await this.identity.principal(s, token)), taskId, this.clock))); }
    async command(token: string | undefined, input: unknown) {
        const v = object(input, campaignCommandKeys), command = str(v.command, 30, true), { command: _command, ...body } = v;
        void _command;
        if (!campaignCommands.includes(command as typeof campaignCommands[number]))
            fail('VALIDATION', 422, '행사 동작을 확인해 주세요.');
        if (command === 'save_catalog') {
            const x = parse.parseSaveCatalog(body);
            return this.identity.repo.transaction(async (s) => {
                const p = (await this.identity.principal(s, token));
                (await manageCatalog(s, p, x.contextId, this.clock));
                (await sourceFiles(s, p, x.contextId, x.draft.source.fileVersionIds, this.clock));
                const old = x.catalogId ? (await s.get('campaignCatalog', x.catalogId)) : null;
                if (x.catalogId && (!old || old.contextId !== x.contextId))
                    unavailable();
                return (await receipt(s, p, x.contextId, 'campaign.catalog', x as unknown as Record<string, unknown>, async () => { fresh(old, x.expectedRevision); const root = old ?? (await s.create('campaignCatalog', { id: newId(), contextId: x.contextId, data: { currentVersionId: null } })), previous = root.data.currentVersionId ? (await s.get('campaignCatalogVersion', root.data.currentVersionId)) : null; const version = (await s.create('campaignCatalogVersion', { id: newId(), contextId: x.contextId, data: { ...x.draft, catalogId: root.id, contextId: x.contextId, sequence: previous ? safe.integer(previous.data.sequence, 1) + 1 : 1, previousId: previous?.id ?? null, recordedBy: p.user.id, recordedAt: this.clock() } })); (await s.update('campaignCatalog', root.id, root.revision, { currentVersionId: version.id })); (await audit(s, p, this.clock, x.contextId, 'campaign.catalog_saved', root.id, { versionId: previous?.id ?? null }, { versionId: version.id })); return { ids: [root.id, version.id] }; }, () => this.fault?.('save_catalog')));
            });
        }
        if (command === 'save') {
            const x = parse.parseSaveCampaign(body);
            return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), task = (await campaignTask(s, p, x.taskId, this.clock, 'manage')); if (task.contextId !== x.contextId)
                unavailable(); (await validateDraft(s, p, task, x.draft, this.clock)); const old = x.campaignId ? (await s.get('campaign', x.campaignId)) : null; if (x.campaignId && (!old || old.contextId !== x.contextId || old.data.taskId !== task.id))
                unavailable(); return (await receipt(s, p, x.contextId, `campaign.save:${task.id}`, x as unknown as Record<string, unknown>, async () => { fresh(old, x.expectedRevision); const row = old ? (await s.update('campaign', old.id, old.revision, { ...old.data, draft: x.draft, draftRequestId: task.data.currentRequestId ?? null })) : (await s.create('campaign', { id: newId(), contextId: x.contextId, data: { taskId: task.id, draft: x.draft, draftRequestId: task.data.currentRequestId ?? null, currentVersionId: null, publicRevision: 0, sequence: 0, createdBy: p.user.id } })); (await audit(s, p, this.clock, x.contextId, 'campaign.draft_saved', row.id, { revision: old?.revision ?? 0 }, { revision: row.revision })); return { ids: [row.id] }; }, () => this.fault?.('save'))); });
        }
        const x = command === 'publish' ? { command: 'publish' as const, ...parse.parsePublishCampaign(body) } : command === 'participate' ? { command: 'participate' as const, ...parse.parseParticipation(body) } : command === 'external' ? { command: 'external' as const, ...parse.parseRecordExternalFact(body) } : command === 'physical' ? { command: 'physical' as const, ...parse.parseRecordPhysicalFact(body) } : { command: 'followup' as const, ...parse.parseRecordFollowup(body) };
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), action = x.command === 'publish' || x.command === 'external' ? 'manage' : 'respond', { row, task } = (await resolveCampaign(s, p, x.campaignId, this.clock, action));
            if (task.id !== x.taskId || task.contextId !== x.contextId)
                unavailable();
            const manage = (await manager(s, p, task.id, this.clock)), published = 'campaignVersionId' in x ? (await s.get('campaignVersion', x.campaignVersionId)) : null;
            if ('campaignVersionId' in x && (!published || published.data.campaignId !== row.id || published.contextId !== row.contextId))
                unavailable();
            const menus = published ? (await versionDTO(s, p, published, this.clock)).menus : [];
            if (x.command === 'publish')
                (await validateDraft(s, p, task, safe.draft(row.data.draft), this.clock));
            if (x.command === 'participate' && 'selectedMenus' in x) {
                x.selectedMenus.forEach(m => menuTarget(menus, m));
                (await provider(s, p, x.contextId, x.providedBy, true));
            }
            if (x.command === 'external' && 'fact' in x && 'axis' in x.fact) {
                menuTarget(menus, x.menu);
                (await provider(s, p, x.contextId, x.fact.requester));
                (await provider(s, p, x.contextId, x.fact.performedBy));
                (await sourceFiles(s, p, x.contextId, x.fact.source.fileVersionIds, this.clock));
            }
            if (x.command === 'physical' && 'physicalKey' in x) {
                const m = menuTarget(menus, x.menu), def = m.physical.find(v => v.key === x.physicalKey);
                if (!def)
                    unavailable();
                (await provider(s, p, x.contextId, x.fact.performedBy, p.user.data.role === 'brand' && x.fact.performedBy.kind === 'user'));
                (await asyncForEach(x.fact.evidence, async (r) => (await exactReference(s, p, r, this.clock))));
                if (x.fact.kind !== 'tracking' && x.fact.unit !== def.unit)
                    fail('VALIDATION', 422, '실물 요청과 같은 단위를 사용해 주세요.');
                if (x.fact.kind === 'receipt')
                    for (const id of x.fact.dispatchFactIds) {
                        const f = (await s.get('campaignPhysicalFact', id));
                        if (!f || f.data.campaignVersionId !== published!.id || f.data.physicalKey !== x.physicalKey || f.data.menu.catalogVersionId !== x.menu.catalogVersionId || f.data.menu.menuKey !== x.menu.menuKey || safe.physical(f.data).kind !== 'dispatch')
                            unavailable();
                    }
            }
            if (x.command === 'followup' && 'followupKey' in x) {
                (await provider(s, p, x.contextId, x.receivedBy, p.user.data.role === 'brand' && x.receivedBy.kind === 'user'));
                (await validateFollowup(s, p, published!, menuTarget(menus, x.menu), x.followupKey, x.source, this.clock));
            }
            return (await receipt(s, p, x.contextId, `campaign.${command}:${row.id}`, x as unknown as Record<string, unknown>, async () => {
                fresh(manage ? row : { revision: safe.integer(row.data.publicRevision) }, x.expectedRevision);
                if (x.command === 'publish') {
                    const draft = safe.draft(row.data.draft), basis = (await campaignPublicationBasis(s, task, row.id, row.data.draftRequestId));
                    (await validateDraft(s, p, task, draft, this.clock, true, basis));
                    parse.assertPublishableCampaign(draft);
                    const content = publicContent(draft), version = (await s.create('campaignVersion', { id: newId(), contextId: row.contextId, data: { ...content, campaignId: row.id, contextId: x.contextId, taskId: task.id, requestId: basis.id, privateDraft: draft, ...this.stamp(s, p, row, row.data.currentVersionId), contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex') } }));
                    (await this.bump(s, row, { currentVersionId: version.id }));
                    const requestId = (await applyCampaignRequest(s, p, version, this.clock, 'publish', null));
                    (await audit(s, p, this.clock, x.contextId, 'campaign.published', row.id, { versionId: row.data.currentVersionId }, { versionId: version.id }));
                    (await this.event(s, p, row, 'CAMPAIGN_PUBLISHED', version.id));
                    return { ids: [row.id, version.id, requestId] };
                }
                let id: string;
                if (x.command === 'participate' && 'selectedMenus' in x) {
                    if (published!.id !== row.data.currentVersionId)
                        fail('CAMPAIGN_CHANGED', 409, '행사 조건이 변경되었습니다. 작성값을 유지하고 현재 공개본을 확인해 주세요.');
                    const prev = (await s.list('campaignSelection', x.contextId)).filter(r => r.data.campaignId === row.id).sort((a, b) => b.data.sequence - a.data.sequence)[0];
                    id = (await s.create('campaignSelection', { id: newId(), contextId: row.contextId, data: { campaignId: row.id, campaignVersionId: published!.id, response: x.response, selectedMenus: x.selectedMenus, providedBy: x.providedBy, note: x.note, ...this.stamp(s, p, row, prev?.id ?? null) } })).id;
                }
                else if (x.command === 'external' && 'fact' in x && 'axis' in x.fact) {
                    const prev = (await s.list('campaignExternalFact', x.contextId)).filter(r => r.data.campaignId === row.id).sort((a, b) => b.data.sequence - a.data.sequence)[0];
                    id = (await s.create('campaignExternalFact', { id: newId(), contextId: row.contextId, data: { ...x.fact, campaignId: row.id, campaignVersionId: published!.id, menu: x.menu, ...this.stamp(s, p, row, prev?.id ?? null) } })).id;
                }
                else if (x.command === 'physical' && 'physicalKey' in x) {
                    const prev = (await s.list('campaignPhysicalFact', x.contextId)).filter(r => r.data.campaignId === row.id).sort((a, b) => b.data.sequence - a.data.sequence)[0];
                    id = (await s.create('campaignPhysicalFact', { id: newId(), contextId: row.contextId, data: { ...x.fact, campaignId: row.id, campaignVersionId: published!.id, menu: x.menu, physicalKey: x.physicalKey, ...this.stamp(s, p, row, prev?.id ?? null) } })).id;
                }
                else if ('followupKey' in x) {
                    const prev = (await s.list('campaignFollowupFact', x.contextId)).filter(r => r.data.campaignId === row.id).sort((a, b) => b.data.sequence - a.data.sequence)[0];
                    id = (await s.create('campaignFollowupFact', { id: newId(), contextId: row.contextId, data: { campaignId: row.id, campaignVersionId: published!.id, menu: x.menu, followupKey: x.followupKey, source: x.source, receivedBy: x.receivedBy, occurredAt: x.occurredAt, note: x.note, ...this.stamp(s, p, row, prev?.id ?? null) } })).id;
                }
                else
                    unavailable();
                (await this.bump(s, row));
                if (x.command === 'participate' || x.command === 'external') {
                    if (published!.id !== row.data.currentVersionId)
                        fail('CAMPAIGN_CHANGED', 409, '현재 공개 행사 버전에서 요청 범위를 다시 확인해 주세요.');
                    (await applyCampaignRequest(s, p, published!, this.clock, x.command, x.command === 'external' ? id : null));
                }
                (await audit(s, p, this.clock, x.contextId, `campaign.${command}`, row.id, {}, { factId: id }));
                (await this.event(s, p, row, x.command === 'participate' ? 'CAMPAIGN_SELECTION_RECORDED' : 'CAMPAIGN_FACT_RECORDED', id));
                return { ids: [row.id, id] };
            }, () => this.fault?.(command)));
        });
    }
}
export type CampaignDetail = Awaited<ReturnType<CampaignService['detail']>>;
export type CampaignList = Awaited<ReturnType<CampaignService['list']>>;
export type CampaignCatalogs = Awaited<ReturnType<CampaignService['catalogs']>>;
export type CampaignSummary = Awaited<ReturnType<CampaignService['remainder']>>;
export type CampaignPreview = Awaited<ReturnType<CampaignService['preview']>>;
