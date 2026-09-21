import { object, ids, list, str, enumValue, dateValue } from '../tasks/validate';
import { requirementTypes, type Requirement, type RequestContent, type RequirementType } from '../tasks/types';
import { fail } from '@/server/auth/errors';
import type { AnswerInput, DraftContent, Inputs, LinkInput, DateInput, Provider, ProductSelection } from './types';
import { answerKey } from './types';
/** Preserve incomplete typed values verbatim. Completeness is a separate evaluator. */
export function rawText(value: unknown, limit = 20000): string {
    if (typeof value !== 'string' || value.length > limit)
        fail('VALIDATION', 422, '입력 형식 또는 길이를 확인해 주세요.');
    return value;
}
const nullableId = (v: unknown) => v === null ? null : ids([v])[0];
export function parseDate(v: unknown): DateInput {
    const d = object(v, ['value', 'precision', 'timezone']);
    return { value: rawText(d.value, 60), precision: enumValue(d.precision, ['date', 'datetime']), timezone: rawText(d.timezone, 100) };
}
export function parseLink(v: unknown): LinkInput {
    const d = object(v, ['url', 'description', 'contentFixed', 'fixedReference']);
    if (d.contentFixed !== false)
        fail('VALIDATION', 422, '외부 링크의 내용은 자동 고정되지 않습니다.');
    let fixedReference: LinkInput['fixedReference'] = null;
    if (d.fixedReference !== null) {
        const ref = object(d.fixedReference, ['kind', 'fileVersionId', 'identifier', 'source']);
        if (ref.kind === 'file') {
            object(ref, ['kind', 'fileVersionId']);
            fixedReference = { kind: 'file', fileVersionId: ids([ref.fileVersionId])[0] };
        }
        else {
            object(ref, ['kind', 'identifier', 'source']);
            enumValue(ref.kind, ['external']);
            fixedReference = { kind: 'external', identifier: rawText(ref.identifier, 500), source: rawText(ref.source, 2000) };
        }
    }
    return { url: rawText(d.url, 2048), description: rawText(d.description, 2000), contentFixed: false, fixedReference };
}
export function parseAnswerInput(type: RequirementType, v: unknown): Inputs[RequirementType] {
    switch (type) {
        case 'short_text':
        case 'long_text': {
            const d = object(v, ['text']);
            return { text: rawText(d.text, type === 'short_text' ? 2000 : 50000) };
        }
        case 'file': {
            const d = object(v, ['fileVersionIds']);
            return { fileVersionIds: ids(d.fileVersionIds) };
        }
        case 'choice': {
            const d = object(v, ['selected']);
            const selected = list(d.selected, 50).map(x => rawText(x, 200));
            if (new Set(selected).size !== selected.length)
                fail('VALIDATION', 422, '선택값이 중복됩니다.');
            return { selected };
        }
        case 'number': {
            const d = object(v, ['value']);
            return { value: rawText(d.value, 200) };
        }
        case 'date': return parseDate(v);
        case 'link': return parseLink(v);
        case 'physical_record': {
            const d = object(v, ['summary', 'items', 'evidenceFileVersionIds', 'observedAt', 'source']);
            return { summary: rawText(d.summary, 10000), source: rawText(d.source, 2000), evidenceFileVersionIds: ids(d.evidenceFileVersionIds), observedAt: d.observedAt === null ? null : parseDate(d.observedAt), items: list(d.items, 80).map(x => { const i = object(x, ['productId', 'quantity', 'unit']); return { productId: nullableId(i.productId), quantity: rawText(i.quantity, 200), unit: rawText(i.unit, 100) }; }) };
        }
    }
}
export function parseSelection(v: unknown): ProductSelection {
    const d = object(v, ['productId', 'expectedCommonRevision', 'expectedContextRevision', 'bindingIds', 'retailPriceVersionId', 'asOfDate']);
    for (const revision of [d.expectedCommonRevision, d.expectedContextRevision])
        if (!Number.isSafeInteger(revision) || Number(revision) < 1)
            fail('VALIDATION', 422, '상품 버전을 확인해 주세요.');
    return { productId: ids([d.productId])[0], expectedCommonRevision: d.expectedCommonRevision as number, expectedContextRevision: d.expectedContextRevision as number, bindingIds: ids(d.bindingIds), retailPriceVersionId: nullableId(d.retailPriceVersionId), asOfDate: rawText(d.asOfDate, 10) };
}
export function parseDraft(v: unknown, requestId: string, content: RequestContent, productIds: string[]): DraftContent {
    const d = object(v, ['answers', 'narrative', 'artifacts', 'links', 'productSelections']);
    const answers = list(d.answers, 400).map(value => {
        const a = object(value, ['requestId', 'requirementKey', 'productId', 'type', 'input']);
        const requirementKey = ids([a.requirementKey])[0], productId = nullableId(a.productId), type = enumValue(a.type, requirementTypes), q = content.requirements.find(q => q.key === requirementKey);
        if (a.requestId !== requestId || !q || q.type !== type || (q.productIds.length ? !productId || !q.productIds.includes(productId) : productId !== null))
            fail('VALIDATION', 422, '답변의 요청·항목·상품 범위를 확인해 주세요.');
        const input = parseAnswerInput(type, a.input);
        if (type === 'physical_record' && (input as Inputs['physical_record']).items.some(i => i.productId && !productIds.includes(i.productId)))
            fail('VALIDATION', 422, '실물 기록의 상품 범위를 확인해 주세요.');
        return { requestId, requirementKey, productId, type, input } as AnswerInput;
    });
    if (new Set(answers.map(answerKey)).size !== answers.length)
        fail('VALIDATION', 422, '답변 항목이 중복됩니다.');
    const artifacts = list(d.artifacts, 160).map(value => {
        const a = object(value, ['fileVersionId', 'role', 'answer']);
        let answer = null;
        if (a.answer !== null) {
            const ref = object(a.answer, ['requirementKey', 'productId']);
            answer = { requirementKey: ids([ref.requirementKey])[0], productId: nullableId(ref.productId) };
            const q = content.requirements.find(q => q.key === answer!.requirementKey);
            if (!q || (q.productIds.length ? !answer.productId || !q.productIds.includes(answer.productId) : answer.productId !== null))
                fail('VALIDATION', 422, '첨부의 항목 범위를 확인해 주세요.');
        }
        return { fileVersionId: ids([a.fileVersionId])[0], role: enumValue(a.role, ['editable_original', 'review_copy', 'evidence']), answer };
    });
    const productSelections = list(d.productSelections, 80).map(parseSelection);
    if (new Set(productSelections.map(p => p.productId)).size !== productSelections.length || productSelections.some(p => !productIds.includes(p.productId)))
        fail('VALIDATION', 422, '상품 선택 범위를 확인해 주세요.');
    return { answers, narrative: rawText(d.narrative, 50000), artifacts, links: list(d.links, 40).map(parseLink), productSelections };
}
export function parseProvider(v: unknown): Provider {
    const d = object(v, ['kind', 'userId', 'label', 'source']);
    if (d.kind === 'user') {
        object(d, ['kind', 'userId']);
        return { kind: 'user', userId: ids([d.userId])[0] };
    }
    object(d, ['kind', 'label', 'source']);
    enumValue(d.kind, ['external_source']);
    return { kind: 'external_source', label: str(d.label, 200, true), source: str(d.source, 2000, true) };
}
export function decimal(value: string): string | null {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))
        return null;
    const [whole, fraction = ''] = value.trim().replace(/^[+-]/, '').split('.');
    const a = (whole || '0').replace(/^0+(?=\d)/, ''), b = fraction.replace(/0+$/, ''), zero = /^0*$/.test(a) && !b;
    return `${value.trim().startsWith('-') && !zero ? '-' : ''}${a}${b ? `.${b}` : ''}`;
}
export function validDate(v: DateInput): boolean {
    try {
        new Intl.DateTimeFormat('en', { timeZone: v.timezone }).format();
        dateValue(v.value.slice(0, 10));
        if (v.precision === 'date')
            return v.value.length === 10;
        return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v.value) && Number.isFinite(Date.parse(v.value));
    }
    catch {
        return false;
    }
}
export function validLink(v: LinkInput): boolean {
    try {
        if (!['http:', 'https:'].includes(new URL(v.url).protocol) || !v.description.trim())
            return false;
    }
    catch {
        return false;
    }
    return !v.fixedReference || v.fixedReference.kind === 'file' || !!v.fixedReference.identifier.trim() && !!v.fixedReference.source.trim();
}
export function normalizeAnswer(q: Requirement, answer: AnswerInput | undefined) {
    const empty = { validity: 'empty' as const, input: answer?.input ?? null, issues: [] as {
            code: string;
            message: string;
        }[] };
    if (!answer)
        return empty;
    const invalid = () => ({ validity: 'invalid' as const, input: answer.input, issues: [{ code: 'INVALID_VALUE', message: '입력 형식과 요청한 값을 확인해 주세요.' }] });
    try {
        const input = parseAnswerInput(q.type, answer.input);
        switch (q.type) {
            case 'short_text':
            case 'long_text':
                if (!(input as Inputs['short_text']).text.trim())
                    return empty;
                break;
            case 'file':
                if (!(input as Inputs['file']).fileVersionIds.length)
                    return empty;
                break;
            case 'choice': {
                const v = input as Inputs['choice'];
                if (!v.selected.length)
                    return empty;
                if (v.selected.some(x => !q.options.includes(x)))
                    return invalid();
                break;
            }
            case 'number': {
                const v = input as Inputs['number'];
                if (!v.value.trim())
                    return empty;
                const value = decimal(v.value);
                if (value === null)
                    return invalid();
                return { validity: 'valid' as const, input: { value }, issues: [] };
            }
            case 'date': {
                const v = input as DateInput;
                if (!v.value.trim())
                    return empty;
                if (!validDate(v))
                    return invalid();
                break;
            }
            case 'link': {
                const v = input as LinkInput;
                if (!v.url.trim() && !v.description.trim() && !v.fixedReference)
                    return empty;
                if (!validLink(v))
                    return invalid();
                break;
            }
            case 'physical_record': {
                const v = input as Inputs['physical_record'];
                if (!v.summary.trim() && !v.items.length && !v.evidenceFileVersionIds.length && !v.source.trim())
                    return empty;
                if (!v.summary.trim() || v.items.some(i => i.quantity.trim() && decimal(i.quantity) === null) || v.observedAt && !validDate(v.observedAt))
                    return invalid();
                break;
            }
        }
        return { validity: 'valid' as const, input, issues: [] };
    }
    catch {
        return invalid();
    }
}
