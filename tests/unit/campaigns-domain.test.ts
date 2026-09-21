import { describe, it, expect } from 'vitest';
import { AuthError } from '@/server/auth/errors';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { builtins } from '@/domain/tasks/templates';
import type { CampaignState, MenuDraft, PublicMenu, SourceText, CampaignProduct, SubmittedReference } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { quantity, parseMenuDraft, parseSourceText, parseSaveCatalog, parseSaveCampaign, assertPublishableCampaign, parsePublishCampaign, parseParticipation, parseExternalFact, parseRecordExternalFact, parseSubmittedReference, parsePhysicalFact, parseRecordPhysicalFact, parseRecordFollowup, withParticipation, withExternalFact, activeMenuObligations, physicalFactsSummary, campaignLimits } from '@/domain/campaigns/validate';
const source = (): SourceText => ({ source: '  원본 메일\n日本語 자료  ', sourceVersion: '2026-v1', locator: 'PDF 3쪽 표2', language: 'ja', originalText: '  原文価格\n 10,000円 · 포인트 별도 ', translatedText: '  번역도 별도 보존\n ', fileVersionIds: ['file-original'] });
const date = () => ({ ...blankContent().deadline, responsibleUserId: 'user-gsg', value: null });
const product = (variant = '판매용 30mL'): CampaignProduct => ({ productId: 'product-serum', productVersionId: 'product-v1', contextProductVersionId: 'context-product-v1', productUseId: null, sampleVariant: variant });
const reference = (): SubmittedReference => ({ taskId: 'task-1', requestId: 'request-1', submissionId: 'submission-1', contentHash: 'a'.repeat(64), answer: { requirementKey: 'proof', productId: null }, fileVersionIds: ['file-submitted'], productUseIds: ['product-use-v1'] });
const command = () => ({ contextId: 'ctx-1', taskId: 'task-1', campaignId: 'campaign-1', expectedRevision: 1, idempotencyKey: 'command-1' });
const person = { kind: 'external_source' as const, label: '합성 담당자', source: '합성 외부 회신' };
const initial = (): CampaignState => ({ response: 'pending', application: 'not_applied', selection: 'pending', preparation: 'not_started', execution: 'not_started', resultReceipt: 'not_received', cancellation: 'none' });
function menu(key = 'one'): MenuDraft {
    const request = { ...blankContent(), title: '선택 메뉴 자료', deadline: date(), requirements: [{ ...blankRequirement('proof', 'file'), label: '실행 사진/리포트' }, { ...blankRequirement('url', 'link'), label: '게시 URL' }] };
    return { identity: { catalogVersionId: 'catalog-v1', menuKey: key, menuName: `메뉴 ${key}`, menuNumber: '1' }, sourceStatements: [{ id: 'price-source', field: 'price', rawValue: '10,000円', source: source() }], conflicts: [], conditions: { state: 'confirmed', sourceStatementIds: ['price-source'], publicExplanation: '현행 견적 미확정 · 확인한 준비물만 안내', cost: { amount: null, currency: null, taxIncluded: 'unknown' }, discount: '', points: '', cancellationTerms: '신청 이후 취소는 별도 협의', schedules: [{ key: 'apply', kind: 'application', deadline: date() }] }, templateVersionId: 'builtin-campaign-v1', request, products: [product(), product('배포용 1mL')], physical: [{ key: 'photo', destination: '촬영 스튜디오 A', purpose: '촬영', product: product(), requestedQuantity: '1', unit: '개', plannedShip: date(), plannedArrival: date() }, { key: 'distribution', destination: '배포 행사장 B', purpose: '배포', product: product('배포용 1mL'), requestedQuantity: '100', unit: '개', plannedShip: date(), plannedArrival: date() }], followups: [{ key: 'photo-result', kind: 'execution_photo', requirementKey: 'proof', deadline: date() }, { key: 'published-url', kind: 'publication_url', requirementKey: 'url', deadline: date() }] };
}
/** Synthetic public definitions for pure policy; not a stored DTO projector. */
function publicDefinition(m: MenuDraft): PublicMenu {
    const request = { title: m.request.title, description: m.request.description, purpose: m.request.purpose, output: m.request.output, productionResponsibility: m.request.productionResponsibility, subtitleResponsibility: m.request.subtitleResponsibility, originalResponsibility: m.request.originalResponsibility, usePlace: m.request.usePlace, nextAction: m.request.nextAction, deadline: m.request.deadline, milestones: m.request.milestones, requirements: m.request.requirements, referenceFileIds: m.request.referenceFileIds, links: m.request.links };
    return { identity: m.identity, conditions: { state: m.conditions.state, publicExplanation: m.conditions.publicExplanation, cost: m.conditions.cost, discount: m.conditions.discount, points: m.conditions.points, cancellationTerms: m.conditions.cancellationTerms, schedules: m.conditions.schedules }, templateVersionId: m.templateVersionId, request, products: m.products, physical: m.physical, followups: m.followups, confirmationIssues: [] };
}
function rejects(action: () => unknown) { try { action(); expect.fail('expected controlled validation error'); } catch (e) { expect(e).toBeInstanceOf(AuthError); expect(e).toMatchObject({ code: 'VALIDATION', status: 422 }); } }
describe('G12 pure campaign contract; real server/auth/AC execution not included', () => {
    it('3 offered menus/1 selected yields only that menu obligations; decline stops eligibility without erasing history', () => {
        const menus = ['one', 'two', 'three'].map(k => publicDefinition(menu(k))), before = structuredClone(menus), state = withParticipation(initial(), 'participate');
        const selected = [menus[1].identity], active = activeMenuObligations(menus, selected, state);
        expect(active).toHaveLength(1); expect(active[0].menu.menuKey).toBe('two'); expect(active[0].physicalKeys).toEqual(['photo', 'distribution']);
        expect(activeMenuObligations(menus, [], state)).toEqual([]);
        expect(activeMenuObligations(menus, selected, withParticipation(state, 'decline'))).toEqual([]);
        expect(activeMenuObligations(menus, selected, withParticipation(state, 'discuss'))).toEqual([]);
        expect(menus).toEqual(before); expect(selected).toEqual([menus[1].identity]);
        active[0].deadlines[0].value = '2030-01-01'; expect(menus[1].request.deadline.value).toBeNull();
        rejects(() => activeMenuObligations(menus, [{ ...menus[0].identity, menuName: '잘못된 이름' }], state));
    });
    it('participation does not apply/select/execute; applied then decline means cancellation discussion only', () => {
        const participated = withParticipation(initial(), 'participate'); expect(participated).toEqual({ ...initial(), response: 'participate' });
        const applied = { ...participated, application: 'applied' as const, preparation: 'ready' as const }, old = structuredClone(applied);
        const declined = withParticipation(applied, 'decline'); expect(declined).toEqual({ ...old, response: 'decline', cancellation: 'discussion' }); expect(applied).toEqual(old);
        const fact = parseExternalFact({ axis: 'execution', value: 'finished', requester: { kind: 'user', userId: 'user-luna' }, performedBy: person, occurredAt: null, source: source(), note: '' });
        expect(withExternalFact(declined, fact)).toEqual({ ...declined, execution: 'finished' });
        expect(withExternalFact(declined, fact).resultReceipt).toBe('not_received');
        rejects(() => parseExternalFact({ ...fact, axis: 'selection', value: 'finished' }));
        rejects(() => parseRecordExternalFact({ ...command(), campaignVersionId: 'campaign-v1', menu: menu().identity, fact: { ...fact, recordedBy: 'forged' } }));
    });
    it('shooting1 vs distribution100 retain destination/variant/unit and unknown schedules independently', () => {
        const input = menu(), parsed = parseMenuDraft(input);
        expect(parsed.physical.map(p => [p.destination, p.purpose, p.product.sampleVariant, p.requestedQuantity, p.unit])).toEqual([['촬영 스튜디오 A', '촬영', '판매용 30mL', '1', '개'], ['배포 행사장 B', '배포', '배포용 1mL', '100', '개']]);
        parsed.physical[0].requestedQuantity = '2'; expect(input.physical[0].requestedQuantity).toBe('1'); expect(parsed.physical[1].requestedQuantity).toBe('100');
        expect(parsed.physical.every(p => p.plannedArrival.value === null)).toBe(true);
        rejects(() => parseMenuDraft({ ...input, physical: [{ ...input.physical[0], product: product('미선택 변형') }] }));
        rejects(() => parseMenuDraft({ ...input, physical: [{ ...input.physical[0], destination: '' }] }));
    });
    it('PDF and tracking facts never imply dispatch or receipt; explicit receipt and source relations stay distinct', () => {
        const tracking = parsePhysicalFact({ kind: 'tracking', carrier: '택배 A', trackingNumber: '000123', trackingUrl: 'https://example.test/track/000123', performedBy: person, occurredAt: null, evidence: [reference()], note: 'PDF 첨부' });
        expect(physicalFactsSummary([tracking])).toEqual({ dispatchFacts: 0, receiptFacts: 0, receipt: 'unconfirmed' });
        const sent = parsePhysicalFact({ kind: 'dispatch', quantity: '1', unit: '개', carrier: '택배 A', trackingNumber: '000123', performedBy: person, occurredAt: { value: '2028-02-29', precision: 'date', timezone: 'Asia/Tokyo' }, evidence: [reference()], note: '' });
        expect(physicalFactsSummary([tracking, sent]).receipt).toBe('unconfirmed');
        const received = parsePhysicalFact({ kind: 'receipt', quantity: '0', unit: '개', dispatchFactIds: ['sent-1'], performedBy: person, occurredAt: null, evidence: [], note: '수령 확인, 실제 수량 0' });
        expect(physicalFactsSummary([tracking, sent, received])).toEqual({ dispatchFacts: 1, receiptFacts: 1, receipt: 'explicit_receipt_recorded' });
        expect(parseRecordPhysicalFact({ ...command(), campaignVersionId: 'campaign-v1', menu: menu().identity, physicalKey: 'photo', fact: sent }).physicalKey).toBe('photo');
        rejects(() => parsePhysicalFact({ ...tracking, receiptConfirmed: true }));
        rejects(() => parsePhysicalFact({ ...tracking, trackingUrl: 'javascript:alert(1)' }));
        rejects(() => parseRecordPhysicalFact({ ...command(), campaignVersionId: 'campaign-v1', menu: menu().identity, physicalKey: 'photo', fact: { ...sent, evidence: [{ ...reference(), taskId: 'foreign' }] } }));
    });
    it('exact decimal text preserves zero/large values; null is unknown and floats/negative/unsafe numbers are rejected', () => {
        expect(quantity(null)).toBeNull(); expect(quantity('0')).toBe('0'); expect(quantity('0001.2500')).toBe('1.25');
        expect(quantity('12345678901234567890.123456')).toBe('12345678901234567890.123456');
        for (const q of [0, Number.MAX_SAFE_INTEGER + 1, Infinity, '-1', '-0', '1e3', 'NaN', {}, '']) rejects(() => quantity(q));
        rejects(() => quantity('1'.repeat(campaignLimits.decimal + 1)));
        const m = menu(); m.conditions.cost = { amount: '0', currency: 'JPY', taxIncluded: 'no' }; expect(parseMenuDraft(m).conditions.cost.amount).toBe('0');
        rejects(() => parseMenuDraft({ ...m, conditions: { ...m.conditions, cost: { ...m.conditions.cost, currency: null } } }));
        rejects(() => parseMenuDraft({ ...m, conditions: { ...m.conditions, cost: { ...m.conditions.cost, currency: 'jpy' } } }));
    });
    it('same menu number across catalog versions differs; original conflicts and chosen public conditions remain separate', () => {
        const m = menu(), old = { ...m.identity, catalogVersionId: 'catalog-old' }; expect(menuIdentityKey(old)).not.toBe(menuIdentityKey(m.identity));
        m.sourceStatements.push({ id: 'new-price', field: 'price', rawValue: '12,000円', source: { ...source(), source: '다른 원본 PDF', sourceVersion: '2027-v2' } }, { id: 'discount', field: 'discount', rawValue: '10% 할인', source: source() }, { id: 'points', field: 'points', rawValue: '100 포인트', source: source() });
        m.conflicts = [{ field: 'price', statementIds: ['price-source', 'new-price'], state: 'needs_confirmation', resolution: '' }];
        m.conditions.discount = '할인 확인 필요'; m.conditions.points = '포인트 별도 확인';
        const parsed = parseMenuDraft(m); expect(parsed.sourceStatements).toEqual(m.sourceStatements); expect(parsed.conflicts[0].state).toBe('needs_confirmation'); expect(parsed.conditions.cost.amount).toBeNull();
        expect(parsed.conditions.discount).not.toBe(parsed.conditions.points);
        for (const field of ['date', 'menu_number'] as const) {
            const conflicting = structuredClone(m);
            conflicting.sourceStatements.push({ id: `${field}-ja`, field, rawValue: field === 'date' ? '2026-10-01' : '3', source: source() }, { id: `${field}-ko`, field, rawValue: field === 'date' ? '2026-10-07' : '4', source: { ...source(), language: 'ko', source: '별도 한국어 안내', locator: '2쪽' } });
            conflicting.conflicts.push({ field, statementIds: [`${field}-ja`, `${field}-ko`], state: 'needs_confirmation', resolution: '' });
            const preserved = parseMenuDraft(conflicting);
            expect(preserved.sourceStatements).toEqual(conflicting.sourceStatements); expect(preserved.conflicts).toEqual(conflicting.conflicts);
            expect(preserved.conditions.schedules[0].deadline.value).toBeNull(); expect(preserved.identity.menuNumber).toBe('1');
        }
        expect(() => assertPublishableCampaign({ title: '확인한 공개 범위', menus: [parsed] })).not.toThrow();
        rejects(() => parseMenuDraft({ ...m, conflicts: [{ ...m.conflicts[0], statementIds: ['price-source', 'points'] }] }));
        rejects(() => parseMenuDraft({ ...m, conflicts: [{ ...m.conflicts[0], state: 'confirmed' }] }));
        expect(parseSourceText(source())).toEqual(source());
    });
    it('reuses all seven G04 templates and recommended specification without inventing answer validators', () => {
        expect(builtins).toHaveLength(7);
        for (const template of builtins) {
            const m = menu(); m.templateVersionId = template.id; m.request = { ...template.data.content, deadline: date() }; m.followups = [];
            expect(parseMenuDraft(m).request.requirements).toEqual(template.data.content.requirements);
        }
        const m = menu(); m.request.requirements[0].specifications = [{ text: '영상 30초 권장', source: '영상 자료', version: 'v1', severity: 'recommended', check: 'human' }];
        expect(parseMenuDraft(m).request.requirements[0].specifications[0].severity).toBe('recommended');
        m.followups[0].requirementKey = 'missing'; rejects(() => parseMenuDraft(m));
    });
    it('draft/publication, unknown keys, exact revisions and size bounds are separate', () => {
        const save = { ...command(), campaignId: null, expectedRevision: 0, draft: { title: '', menus: [] } };
        expect(parseSaveCampaign(save).draft.menus).toEqual([]); rejects(() => assertPublishableCampaign(parseSaveCampaign(save).draft));
        expect(() => assertPublishableCampaign({ title: '행사', menus: [menu()] })).not.toThrow();
        const pending = menu(); pending.conditions.state = 'needs_confirmation'; rejects(() => assertPublishableCampaign({ title: '행사', menus: [pending] }));
        for (const revision of [0, -1, 1.5, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) rejects(() => parsePublishCampaign({ ...command(), expectedRevision: revision }));
        rejects(() => parseSaveCampaign({ ...save, expectedRevision: 1 })); rejects(() => parsePublishCampaign({ ...command(), publishedBy: 'forged' }));
        rejects(() => parseSaveCampaign({ ...save, draft: { title: '행사', menus: Array.from({ length: 21 }, (_, i) => menu(`m-${i}`)) } }));
        rejects(() => parseSourceText({ ...source(), originalText: { secret: 'nested' } }));
        expect(parseSaveCatalog({ contextId: 'ctx-1', catalogId: null, expectedRevision: 0, idempotencyKey: 'save', draft: { title: '', versionLabel: '', source: source() } }).draft.source.originalText).toBe(source().originalText);
    });
    it('exact submitted/file/productUse reference and independent followup dates cannot be replaced with current versions', () => {
        expect(parseSubmittedReference(reference())).toEqual(reference());
        rejects(() => parseSubmittedReference({ ...reference(), expectedCommonRevision: 2 }));
        rejects(() => parseSubmittedReference({ ...reference(), contentHash: { marker: true } }));
        rejects(() => parseSubmittedReference({ ...reference(), productUseIds: ['x', 'x'] }));
        const c = { ...command(), campaignVersionId: 'campaign-v1', menu: menu().identity, followupKey: 'photo-result', source: reference(), receivedBy: person, occurredAt: null, note: '' };
        expect(parseRecordFollowup(c).source.submissionId).toBe('submission-1');
        rejects(() => parseRecordFollowup({ ...c, source: { ...reference(), taskId: 'other' } }));
        for (const value of ['2026-02-29', '2026-13-01']) rejects(() => parseRecordFollowup({ ...c, occurredAt: { value, precision: 'date', timezone: 'Asia/Tokyo' } }));
        const m = menu(); m.followups[0].deadline.value = '2028-02-29'; m.followups[1].deadline.value = '2028-03-02';
        expect(parseMenuDraft(m).followups.map(f => f.deadline.value)).toEqual(['2028-02-29', '2028-03-02']);
        m.followups[0].deadline.timezone = 'not-a-timezone'; rejects(() => parseMenuDraft(m));
    });
    it('decline may preserve selected history and proxy provider but cannot forge application or server identity', () => {
        const p = { ...command(), campaignVersionId: 'campaign-v1', response: 'decline', selectedMenus: [menu().identity], providedBy: person, note: '신청 이후 취소 협의 요청' };
        expect(parseParticipation(p)).toMatchObject({ response: 'decline', selectedMenus: p.selectedMenus, providedBy: person });
        rejects(() => parseParticipation({ ...p, application: 'cancelled' })); rejects(() => parseParticipation({ ...p, recordedAt: 'forged' }));
        rejects(() => parseParticipation({ ...p, selectedMenus: [...p.selectedMenus, ...p.selectedMenus] }));
    });
});
