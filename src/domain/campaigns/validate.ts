import { fail } from '@/server/auth/errors';
import { object, ids, list, str, enumValue, deadline, content } from '../tasks/validate';
import { rawText, decimal, parseDate, validDate, parseProvider } from '../submissions/validate';
import { menuIdentityKey, type MenuIdentity, type SourceText, type SourceStatement, type SourceConflict, type StatementField, type CampaignProduct, type MenuConditions, type MenuDraft, type CampaignDraft, type CampaignState, type PublicMenu, type ActiveMenuObligations, type ExternalFactInput, type PhysicalFactInput, type SubmittedReference, type SaveCatalogCommand, type SaveCampaignCommand, type PublishCampaignCommand, type ParticipationCommand, type RecordExternalFactCommand, type RecordPhysicalFactCommand, type RecordFollowupCommand } from './types';
export const campaignLimits = { menus: 20, entries: 80, sourceText: 50000, note: 10000, decimal: 200 } as const;
const id = (v: unknown) => ids([v])[0];
const nullableId = (v: unknown) => v === null ? null : id(v);
const fields = ['menu_number', 'menu_name', 'date', 'price', 'discount', 'points', 'past_performance'] as const;
function revision(v: unknown, zero = true) { if (!Number.isSafeInteger(v) || Number(v) < (zero ? 0 : 1)) fail('VALIDATION', 422, '정확한 기준 버전을 확인해 주세요.'); return Number(v); }
function editRevision(recordId: string | null, v: unknown) { const r = revision(v); if ((recordId === null) !== (r === 0)) fail('VALIDATION', 422, '신규 또는 기존 초안의 기준 버전을 확인해 주세요.'); return r; }
function unique<T>(values: T[], key: (v: T) => string): T[] { if (new Set(values.map(key)).size !== values.length) fail('VALIDATION', 422, '같은 항목을 중복 지정할 수 없습니다.'); return values; }
function observedDate(v: unknown) { if (v === null) return null; const d = parseDate(v); if (!validDate(d)) fail('VALIDATION', 422, '실제 날짜·시각과 시간대를 확인해 주세요.'); return d; }
/** Exact decimal text, no floating point or amount ceiling. Null means unknown, not zero. */
export function quantity(v: unknown): string | null {
    if (v === null) return null;
    const raw = rawText(v, campaignLimits.decimal), value = decimal(raw);
    if (value === null || raw.trim().startsWith('-')) fail('VALIDATION', 422, '수량·금액은 음수가 아닌 정확한 숫자 문자열로 입력해 주세요.');
    return value;
}
const knownQuantity = (v: unknown) => { const q = quantity(v); if (q === null) fail('VALIDATION', 422, '실제 수량을 명시해 주세요.'); return q; };
export function parseMenuIdentity(v: unknown): MenuIdentity {
    const d = object(v, ['catalogVersionId', 'menuKey', 'menuName', 'menuNumber']);
    return { catalogVersionId: id(d.catalogVersionId), menuKey: id(d.menuKey), menuName: str(d.menuName, 300, true), menuNumber: str(d.menuNumber, 100) };
}
export function parseSourceText(v: unknown): SourceText {
    const d = object(v, ['source', 'sourceVersion', 'locator', 'language', 'originalText', 'translatedText', 'fileVersionIds']);
    return { source: rawText(d.source, 5000), sourceVersion: rawText(d.sourceVersion, 300), locator: rawText(d.locator, 2000), language: str(d.language, 80), originalText: rawText(d.originalText, campaignLimits.sourceText), translatedText: rawText(d.translatedText, campaignLimits.sourceText), fileVersionIds: ids(d.fileVersionIds) };
}
export function parseProduct(v: unknown): CampaignProduct {
    const d = object(v, ['productId', 'productVersionId', 'contextProductVersionId', 'productUseId', 'sampleVariant']);
    return { productId: id(d.productId), productVersionId: id(d.productVersionId), contextProductVersionId: id(d.contextProductVersionId), productUseId: nullableId(d.productUseId), sampleVariant: str(d.sampleVariant, 400) };
}
const productKey = (p: CampaignProduct) => JSON.stringify([p.productId, p.productVersionId, p.contextProductVersionId, p.productUseId, p.sampleVariant]);
function conditions(v: unknown): MenuConditions {
    const d = object(v, ['state', 'sourceStatementIds', 'publicExplanation', 'cost', 'discount', 'points', 'cancellationTerms', 'schedules']);
    const c = object(d.cost, ['amount', 'currency', 'taxIncluded']), amount = quantity(c.amount), currency = c.currency === null ? null : str(c.currency, 3, true);
    if (currency !== null && !/^[A-Z]{3}$/.test(currency) || amount !== null && currency === null) fail('VALIDATION', 422, '금액의 통화를 ISO 3자리 코드로 명시해 주세요.');
    const schedules = unique(list(d.schedules, 40).map(v => { const s = object(v, ['key', 'kind', 'deadline']); return { key: id(s.key), kind: enumValue(s.kind, ['application', 'delivery', 'publication']), deadline: deadline(s.deadline) }; }), s => s.key);
    return { state: enumValue(d.state, ['needs_confirmation', 'confirmed']), sourceStatementIds: ids(d.sourceStatementIds), publicExplanation: rawText(d.publicExplanation, campaignLimits.note), cost: { amount, currency, taxIncluded: enumValue(c.taxIncluded, ['unknown', 'yes', 'no']) }, discount: rawText(d.discount, 5000), points: rawText(d.points, 5000), cancellationTerms: rawText(d.cancellationTerms, 5000), schedules };
}
export function parseMenuDraft(v: unknown): MenuDraft {
    const d = object(v, ['identity', 'sourceStatements', 'conflicts', 'conditions', 'templateVersionId', 'request', 'products', 'physical', 'followups']);
    const sourceStatements: SourceStatement[] = unique(list(d.sourceStatements).map(v => { const s = object(v, ['id', 'field', 'rawValue', 'source']); return { id: id(s.id), field: enumValue(s.field, fields), rawValue: rawText(s.rawValue, 5000), source: parseSourceText(s.source) }; }), s => s.id);
    const conflicts: SourceConflict[] = unique(list(d.conflicts).map(v => {
        const c = object(v, ['field', 'statementIds', 'state', 'resolution']), field = enumValue(c.field, fields), statementIds = ids(c.statementIds), state = enumValue(c.state, ['needs_confirmation', 'confirmed']), resolution = rawText(c.resolution, 5000);
        if (statementIds.length < 2 || statementIds.some(id => !sourceStatements.some(s => s.id === id && s.field === field)) || state === 'confirmed' && !resolution.trim()) fail('VALIDATION', 422, '상충하는 원문별 출처와 명시 확인 설명을 유지해 주세요.');
        return { field, statementIds, state, resolution };
    }), c => c.field);
    const confirmed = conditions(d.conditions);
    if (confirmed.sourceStatementIds.some(id => !sourceStatements.some(s => s.id === id))) fail('VALIDATION', 422, '공개 조건의 원문 출처를 확인해 주세요.');
    const request = content(d.request), products = unique(list(d.products).map(parseProduct), productKey);
    if (request.requirements.some(q => q.productIds.some(id => !products.some(p => p.productId === id)))) fail('VALIDATION', 422, '요청 항목의 선택 상품 범위를 확인해 주세요.');
    const physical = unique(list(d.physical).map(v => {
        const p = object(v, ['key', 'destination', 'purpose', 'product', 'requestedQuantity', 'unit', 'plannedShip', 'plannedArrival']), product = parseProduct(p.product);
        if (!products.some(x => productKey(x) === productKey(product))) fail('VALIDATION', 422, '실물의 정확한 상품·샘플 변형을 선택해 주세요.');
        return { key: id(p.key), destination: str(p.destination, 2000, true), purpose: str(p.purpose, 1000, true), product, requestedQuantity: quantity(p.requestedQuantity), unit: str(p.unit, 100, true), plannedShip: deadline(p.plannedShip), plannedArrival: deadline(p.plannedArrival) };
    }), p => p.key);
    const followups = unique(list(d.followups).map(v => {
        const f = object(v, ['key', 'kind', 'requirementKey', 'deadline']), kind = enumValue(f.kind, ['publication_url', 'execution_photo', 'performance_report', 'custom']), requirementKey = id(f.requirementKey), q = request.requirements.find(q => q.key === requirementKey);
        if (!q || kind === 'publication_url' && q.type !== 'link' || ['execution_photo', 'performance_report'].includes(kind) && q.type !== 'file') fail('VALIDATION', 422, '후속 산출물의 실제 요청 항목·형식을 확인해 주세요.');
        return { key: id(f.key), kind, requirementKey, deadline: deadline(f.deadline) };
    }), f => f.key);
    return { identity: parseMenuIdentity(d.identity), sourceStatements, conflicts, conditions: confirmed, templateVersionId: nullableId(d.templateVersionId), request, products, physical, followups };
}
export function parseCampaignDraft(v: unknown): CampaignDraft {
    const d = object(v, ['title', 'menus']);
    return { title: rawText(d.title, 300), menus: unique(list(d.menus, campaignLimits.menus).map(parseMenuDraft), m => menuIdentityKey(m.identity)) };
}
export function assertPublishableCampaign(draft: CampaignDraft): void {
    const d = parseCampaignDraft(draft);
    if (!d.title.trim() || !d.menus.length || d.menus.some(m => m.conditions.state !== 'confirmed' || !m.conditions.publicExplanation.trim() || !m.conditions.sourceStatementIds.length || !m.request.title.trim())) fail('VALIDATION', 422, '메뉴와 사람이 확인한 공개 조건·설명을 확인해 주세요.');
    // Source conflicts remain independent, even after a GSG explicitly selects public conditions.
}
function identity(v: Record<string, unknown>) { return { contextId: id(v.contextId), taskId: id(v.taskId), campaignId: id(v.campaignId), expectedRevision: revision(v.expectedRevision, false), idempotencyKey: str(v.idempotencyKey, 160, true) }; }
const commandKeys = ['contextId', 'taskId', 'campaignId', 'expectedRevision', 'idempotencyKey'];
export function parseSaveCatalog(v: unknown): SaveCatalogCommand {
    const d = object(v, ['contextId', 'catalogId', 'expectedRevision', 'idempotencyKey', 'draft']), b = object(d.draft, ['title', 'versionLabel', 'source']), catalogId = nullableId(d.catalogId);
    return { contextId: id(d.contextId), catalogId, expectedRevision: editRevision(catalogId, d.expectedRevision), idempotencyKey: str(d.idempotencyKey, 160, true), draft: { title: rawText(b.title, 300), versionLabel: rawText(b.versionLabel, 300), source: parseSourceText(b.source) } };
}
export function parseSaveCampaign(v: unknown): SaveCampaignCommand {
    const d = object(v, [...commandKeys, 'draft']), campaignId = nullableId(d.campaignId);
    return { contextId: id(d.contextId), taskId: id(d.taskId), campaignId, expectedRevision: editRevision(campaignId, d.expectedRevision), idempotencyKey: str(d.idempotencyKey, 160, true), draft: parseCampaignDraft(d.draft) };
}
export function parsePublishCampaign(v: unknown): PublishCampaignCommand { return identity(object(v, commandKeys)); }
export function parseParticipation(v: unknown): ParticipationCommand {
    const d = object(v, [...commandKeys, 'campaignVersionId', 'response', 'selectedMenus', 'providedBy', 'note']);
    return { ...identity(d), campaignVersionId: id(d.campaignVersionId), response: enumValue(d.response, ['participate', 'decline', 'discuss']), selectedMenus: unique(list(d.selectedMenus, campaignLimits.menus).map(parseMenuIdentity), menuIdentityKey), providedBy: parseProvider(d.providedBy), note: rawText(d.note, campaignLimits.note) };
}
const axisValues = {
    application: ['not_applied', 'applied', 'withdrawal_requested', 'cancelled'], selection: ['pending', 'selected', 'not_selected'], preparation: ['not_started', 'preparing', 'ready'], execution: ['not_started', 'in_progress', 'finished'], resultReceipt: ['not_received', 'partial', 'received'], cancellation: ['none', 'discussion', 'cancelled'],
} as const;
export function parseExternalFact(v: unknown): ExternalFactInput {
    const d = object(v, ['axis', 'value', 'requester', 'performedBy', 'occurredAt', 'source', 'note']), axis = enumValue(d.axis, ['application', 'selection', 'preparation', 'execution', 'resultReceipt', 'cancellation']);
    const value = enumValue(d.value, axisValues[axis] as readonly string[]);
    return { axis, value, requester: parseProvider(d.requester), performedBy: parseProvider(d.performedBy), occurredAt: observedDate(d.occurredAt), source: parseSourceText(d.source), note: rawText(d.note, campaignLimits.note) } as ExternalFactInput;
}
export function parseRecordExternalFact(v: unknown): RecordExternalFactCommand {
    const d = object(v, [...commandKeys, 'campaignVersionId', 'menu', 'fact']);
    return { ...identity(d), campaignVersionId: id(d.campaignVersionId), menu: parseMenuIdentity(d.menu), fact: parseExternalFact(d.fact) };
}
export function parseSubmittedReference(v: unknown): SubmittedReference {
    const d = object(v, ['taskId', 'requestId', 'submissionId', 'contentHash', 'answer', 'fileVersionIds', 'productUseIds']), contentHash = str(d.contentHash, 64, true);
    if (!/^[a-f0-9]{64}$/.test(contentHash)) fail('VALIDATION', 422, '정확한 제출 해시를 확인해 주세요.');
    let answer: SubmittedReference['answer'] = null;
    if (d.answer !== null) { const a = object(d.answer, ['requirementKey', 'productId']); answer = { requirementKey: id(a.requirementKey), productId: nullableId(a.productId) }; }
    return { taskId: id(d.taskId), requestId: id(d.requestId), submissionId: id(d.submissionId), contentHash, answer, fileVersionIds: ids(d.fileVersionIds), productUseIds: ids(d.productUseIds) };
}
export function parsePhysicalFact(v: unknown): PhysicalFactInput {
    const common = ['kind', 'performedBy', 'occurredAt', 'evidence', 'note'], d = object(v, [...common, 'carrier', 'trackingNumber', 'trackingUrl', 'quantity', 'unit', 'dispatchFactIds']);
    const kind = enumValue(d.kind, ['tracking', 'dispatch', 'receipt']), provenance = { performedBy: parseProvider(d.performedBy), occurredAt: observedDate(d.occurredAt), evidence: list(d.evidence).map(parseSubmittedReference), note: rawText(d.note, campaignLimits.note) };
    if (kind === 'tracking') {
        object(d, [...common, 'carrier', 'trackingNumber', 'trackingUrl']); const trackingUrl = d.trackingUrl === null ? null : str(d.trackingUrl, 2048, true);
        if (trackingUrl !== null) { try { if (!['http:', 'https:'].includes(new URL(trackingUrl).protocol)) throw 0; } catch { fail('VALIDATION', 422, '송장 조회 주소 형식을 확인해 주세요.'); } }
        return { ...provenance, kind, carrier: str(d.carrier, 300, true), trackingNumber: str(d.trackingNumber, 300, true), trackingUrl };
    }
    if (kind === 'dispatch') { object(d, [...common, 'quantity', 'unit', 'carrier', 'trackingNumber']); return { ...provenance, kind, quantity: knownQuantity(d.quantity), unit: str(d.unit, 100, true), carrier: str(d.carrier, 300), trackingNumber: str(d.trackingNumber, 300) }; }
    object(d, [...common, 'quantity', 'unit', 'dispatchFactIds']);
    return { ...provenance, kind, quantity: knownQuantity(d.quantity), unit: str(d.unit, 100, true), dispatchFactIds: ids(d.dispatchFactIds) };
}
export function parseRecordPhysicalFact(v: unknown): RecordPhysicalFactCommand {
    const d = object(v, [...commandKeys, 'campaignVersionId', 'menu', 'physicalKey', 'fact']), result = { ...identity(d), campaignVersionId: id(d.campaignVersionId), menu: parseMenuIdentity(d.menu), physicalKey: id(d.physicalKey), fact: parsePhysicalFact(d.fact) };
    if (result.fact.evidence.some(e => e.taskId !== result.taskId)) fail('VALIDATION', 422, '실물 증빙의 업무 범위를 확인해 주세요.');
    return result;
}
export function parseRecordFollowup(v: unknown): RecordFollowupCommand {
    const d = object(v, [...commandKeys, 'campaignVersionId', 'menu', 'followupKey', 'source', 'receivedBy', 'occurredAt', 'note']), result = { ...identity(d), campaignVersionId: id(d.campaignVersionId), menu: parseMenuIdentity(d.menu), followupKey: id(d.followupKey), source: parseSubmittedReference(d.source), receivedBy: parseProvider(d.receivedBy), occurredAt: observedDate(d.occurredAt), note: rawText(d.note, campaignLimits.note) };
    if (result.source.taskId !== result.taskId) fail('VALIDATION', 422, '후속 산출물의 정확한 업무·제출을 선택해 주세요.');
    return result;
}
/** Pure update policy. Actual history, authority and atomic writes remain server responsibilities. */
export function withParticipation(state: CampaignState, response: ParticipationCommand['response']): CampaignState {
    return { ...state, response, cancellation: response === 'decline' && ['applied', 'withdrawal_requested'].includes(state.application) && state.cancellation !== 'cancelled' ? 'discussion' : state.cancellation };
}
export function withExternalFact(state: CampaignState, fact: ExternalFactInput): CampaignState { return { ...state, [fact.axis]: fact.value }; }
/** Eligible definitions only, not a missing-count evaluator or notification delivery. */
export function activeMenuObligations(menus: readonly PublicMenu[], selected: readonly MenuIdentity[], state: CampaignState): ActiveMenuObligations[] {
    const keys = new Set(unique([...selected], menuIdentityKey).map(menuIdentityKey));
    if (selected.some(s => !menus.some(m => menuIdentityKey(m.identity) === menuIdentityKey(s) && m.identity.menuName === s.menuName && m.identity.menuNumber === s.menuNumber))) fail('VALIDATION', 422, '공개된 정확한 메뉴 버전을 선택해 주세요.');
    if (state.response !== 'participate' || state.application === 'cancelled' || state.cancellation === 'cancelled' || state.selection === 'not_selected') return [];
    return menus.filter(m => keys.has(menuIdentityKey(m.identity))).map(m => ({ menu: { ...m.identity }, requirementKeys: m.request.requirements.map(q => q.key), physicalKeys: m.physical.map(p => p.key), followupKeys: m.followups.map(f => f.key), deadlines: structuredClone([m.request.deadline, ...m.conditions.schedules.map(s => s.deadline), ...m.followups.map(f => f.deadline), ...m.physical.flatMap(p => [p.plannedShip, p.plannedArrival])]) }));
}
/** A receipt fact is explicit observation, never inferred from PDF or tracking. No quantity completion calculation. */
export function physicalFactsSummary(facts: readonly PhysicalFactInput[]) {
    return { dispatchFacts: facts.filter(f => f.kind === 'dispatch').length, receiptFacts: facts.filter(f => f.kind === 'receipt').length, receipt: facts.some(f => f.kind === 'receipt') ? 'explicit_receipt_recorded' as const : 'unconfirmed' as const };
}
export const statementFields: readonly StatementField[] = fields;
