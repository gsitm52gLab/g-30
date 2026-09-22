import { randomUUID } from 'node:crypto';
import type { IdentityService } from '@/server/auth/service';
import { CampaignService } from '@/server/campaigns/service';
import { TaskService } from '@/server/tasks/service';
import { ProductService } from '@/server/products/service';
import { SubmissionService } from '@/server/submissions/service';
import { SubmissionFiles } from '@/server/submissions/files';
import { blankCommon, blankContext } from '@/domain/products/types';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import type { CampaignDraft, MenuDraft, SourceText, SubmittedReference } from '@/domain/campaigns/types';
import { admin, brand, contextId, png } from './completion';
export const campaignMarker = 'COMPLETION_PRIVATE_CAMPAIGN_CANARY';
export const source = (): SourceText => ({ source: campaignMarker, sourceVersion: 'v1', locator: 'p2', language: 'ja', originalText: campaignMarker, translatedText: campaignMarker, fileVersionIds: [] });
export const person = { kind: 'user' as const, userId: 'user-luna' };
export async function completionCampaign(identity: IdentityService, general = false) {
    const repo = identity.repo, campaigns = new CampaignService(identity), tasks = new TaskService(identity), products = new ProductService(identity);
    const p1 = await products.detail(admin, 'product-serum', contextId);
    const p2id = (await products.create(admin, { contextId, brandId: p1.context.data.brandId, common: { ...blankCommon(), name: '미선택 상품', code: 'C11-' + randomUUID() }, fields: blankContext(), idempotencyKey: randomUUID() })).ids[0];
    const p2 = await products.detail(admin, p2id, contextId);
    const content = { ...blankContent(), title: '실제 캠페인 완료', description: '자료 범위와 실물 사실 분리', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('proof', 'file'), label: '사진' }, { ...blankRequirement('url', 'link'), label: 'URL' }, { ...blankRequirement('other', 'number'), label: '다른 메뉴 수량' }, ...(general ? [{ ...blankRequirement('general'), label: '일반 요청' }] : [])] };
    const taskId = (await tasks.create(admin, { category: 'spot', content, targets: [{ contextId, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: [p1.productId, p2.productId] }], idempotencyKey: randomUUID() })).ids[0];
    await tasks.command(admin, taskId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
    const catalogVersionId = (await campaigns.command(admin, { command: 'save_catalog', contextId, catalogId: null, expectedRevision: 0, idempotencyKey: randomUUID(), draft: { title: '합성 원문', versionLabel: 'v1', source: source() } })).ids[1];
    const menu = (key: string, first: boolean): MenuDraft => {
        const p = first ? p1 : p2, product = { productId: p.productId, productVersionId: p.commonVersionId, contextProductVersionId: p.contextVersionId, productUseId: null, sampleVariant: '샘플' };
        return { identity: { catalogVersionId, menuKey: key, menuName: first ? '촬영' : '미선택 메뉴', menuNumber: '1' }, sourceStatements: [{ id: 'price', field: 'price', rawValue: campaignMarker, source: source() }], conflicts: [], conditions: { state: 'confirmed', sourceStatementIds: ['price'], publicExplanation: '공개 조건', cost: { amount: '12345', currency: 'JPY', taxIncluded: 'unknown' }, discount: campaignMarker, points: '', cancellationTerms: '신청 후 협의', schedules: [] }, templateVersionId: null, request: { ...content, internalOriginal: campaignMarker, internalMemo: campaignMarker, requirements: first ? content.requirements.slice(0, 2) : content.requirements.slice(2, 3) }, products: [product], physical: first ? [{ key: 'shoot', purpose: '촬영', destination: '촬영 A', requestedQuantity: '1', unit: '개', product, plannedShip: content.deadline, plannedArrival: content.deadline }, { key: 'distribution', purpose: '배포', destination: '배포 B', requestedQuantity: '100', unit: '개', product, plannedShip: content.deadline, plannedArrival: content.deadline }] : [], followups: first ? [{ key: 'photo', kind: 'execution_photo', requirementKey: 'proof', deadline: content.deadline }, { key: 'url', kind: 'publication_url', requirementKey: 'url', deadline: content.deadline }] : [] };
    };
    const draft: CampaignDraft = { title: '실제 행사', menus: [menu('one', true), menu('two', false), menu('three', false)] };
    const campaignId = (await campaigns.command(admin, { command: 'save', contextId, taskId, campaignId: null, expectedRevision: 0, idempotencyKey: randomUUID(), draft })).ids[0];
    async function command(command: string, extra: Record<string, unknown> = {}, token = admin) { const row = await campaigns.detail(token, campaignId); return (await campaigns.command(token, { command, contextId, taskId, campaignId, expectedRevision: row.revision, idempotencyKey: randomUUID(), ...extra })); }
    const versionId = (await command('publish')).ids[1];
    async function select(response = 'participate') { return (await command('participate', { campaignVersionId: versionId, response, selectedMenus: response === 'participate' ? [draft.menus[0].identity] : [], providedBy: person, note: '' }, brand)); }
    async function applied() { return (await command('external', { campaignVersionId: versionId, menu: draft.menus[0].identity, fact: { axis: 'application', value: 'applied', requester: person, performedBy: person, occurredAt: null, source: source(), note: campaignMarker } })); }
    async function physical(kind: 'tracking' | 'dispatch' | 'receipt', dispatchFactIds: string[] = [], evidence: SubmittedReference[] = []) { return (await command('physical', { campaignVersionId: versionId, menu: draft.menus[0].identity, physicalKey: 'shoot', fact: { kind, performedBy: person, occurredAt: null, evidence, note: campaignMarker, ...(kind === 'tracking' ? { carrier: '합성택배', trackingNumber: '0001', trackingUrl: null } : kind === 'dispatch' ? { quantity: '1', unit: '개', carrier: '합성택배', trackingNumber: '0001' } : { quantity: '0', unit: '개', dispatchFactIds }) } }, brand)); }
    async function submitted(directory: string) {
        const sub = new SubmissionService(identity);
        let w = await sub.workspace(brand, taskId);
        const upload = (await new SubmissionFiles(identity, directory).upload(brand, taskId, w.request.id, [{ clientItemId: randomUUID(), name: 'proof.png', type: 'image/png', bytes: png }])).items[0];
        if (upload.state !== 'ready')
            throw Error('fixture upload');
        await sub.draft(brand, taskId, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: w.draft?.revision ?? 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'proof', productId: null, type: 'file', input: { fileVersionIds: [upload.file.id] } }], artifacts: [{ fileVersionId: upload.file.id, role: 'evidence', answer: { requirementKey: 'proof', productId: null } }], productSelections: [{ productId: p1.productId, expectedCommonRevision: p1.commonRevision, expectedContextRevision: p1.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }] }, idempotencyKey: randomUUID() });
        w = await sub.workspace(brand, taskId);
        const id = (await sub.submit(brand, taskId, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'partial', idempotencyKey: randomUUID() })).ids[0];
        const row = (await repo.get('submission', id))!;
        return { taskId, requestId: row.data.requestId, submissionId: row.id, contentHash: row.data.contentHash, answer: { requirementKey: 'proof', productId: null }, fileVersionIds: [upload.file.id], productUseIds: row.data.productUseIds } satisfies SubmittedReference;
    }
    return { taskId, campaignId, versionId, draft, p1, p2, command, select, applied, physical, submitted };
}
