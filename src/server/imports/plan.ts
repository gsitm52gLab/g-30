import type { Clock, UnitOfWork } from '@/domain/records';
import { blankCommon, blankContext, blankRetailPrice, blankInternalPrice, normalizeProductCode, type ProductCommon, type ProductContextFields, type RetailPriceFields, type InternalPriceFields } from '@/domain/products/types';
import { commonInput, contextInput, retailInput, internalInput } from '@/domain/products/validate';
import { importFields, type ImportField } from '@/domain/imports/fields';
import { importLimits, type ParsedSheet, type ParsedCell, type Mapping, type RowChoice, type PreviewRow, type ImportError } from '@/domain/imports/types';
import type { Principal } from '@/server/auth/service';
import { fail, AuthError } from '@/server/auth/errors';
import { resolveProduct, productContextScope } from '@/server/products/access';
import { authorize, decide } from '@/server/policy/policy';
import { validateProductProject } from '@/server/products/mutations';
import { commonDTO, contextDTO, retailDTO, internalDTO } from '@/server/products/projection';
export interface PlannedRow {
    preview: PreviewRow;
    common: ProductCommon;
    local: ProductContextFields;
    retail: RetailPriceFields | null;
    internal: InternalPriceFields | null;
    changed: {
        common: boolean;
        local: boolean;
        retail: boolean;
        internal: boolean;
    };
}
export function checkMapping(mapping: Mapping[], privatePrice: boolean) {
    if (!Array.isArray(mapping) || !mapping.length || mapping.length > importLimits.columns)
        fail('VALIDATION', 422, '열 매핑을 확인해 주세요.');
    const keys = new Set<string>(), columns = new Set<number>();
    for (const m of mapping) {
        if (!Number.isSafeInteger(m.column) || m.column < 1 || m.column > 100 || !importFields.some(f => f.key === m.field) || keys.has(m.field) || columns.has(m.column))
            fail('VALIDATION', 422, '중복되거나 지원하지 않는 열 매핑입니다.');
        if (m.field.startsWith('internal.') && !privatePrice)
            fail('FORBIDDEN', 403, '내부 가격 열을 가져올 권한이 없습니다.');
        keys.add(m.field);
        columns.add(m.column);
    }
    if (!keys.has('contextKey') || !keys.has('common.code'))
        fail('VALIDATION', 422, '컨텍스트 키와 제품 코드를 매핑해 주세요.');
}
function setValue(target: object, path: string, value: unknown) { const parts = path.split('.'); let obj = target as Record<string, unknown>; for (const key of parts.slice(0, -1))
    obj = obj[key] as Record<string, unknown>; obj[parts.at(-1)!] = value; }
function decimalText(value: string) {
    if (!/^[+]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(value))
        throw new Error('0 이상의 소수여야 합니다.');
    const [base, exponent] = value.replace(/^\+/, '').toLowerCase().split('e');
    if (!exponent)
        return base;
    const exp = Number(exponent);
    if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000)
        throw new Error('소수 표현 범위를 확인해 주세요.');
    const [whole, fraction = ''] = base.split('.'), digits = whole + fraction, point = whole.length + exp;
    return point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
}
function valueOf(cell: ParsedCell, field: ImportField): string | boolean | null {
    if (cell.error)
        throw new Error(cell.error === 'FORMULA_UNSUPPORTED' ? '수식과 캐시된 계산값은 가져올 수 없습니다.' : '셀 형식을 읽을 수 없습니다.');
    const text = cell.text;
    if (field.type === 'identifier' && cell.type === 'number')
        throw new Error('식별자는 Excel 텍스트 셀이어야 합니다. 손실된 앞자리 0은 추정하지 않습니다.');
    if (field.type === 'boolean') {
        if (!['true', 'false'].includes(text.trim().toLowerCase()))
            throw new Error('true 또는 false를 입력해 주세요.');
        return text.trim().toLowerCase() === 'true';
    }
    if (field.type === 'decimal')
        return decimalText(text.trim());
    if (field.type === 'date') {
        if (cell.type === 'date') {
            if (!text.endsWith('T00:00:00.000Z'))
                throw new Error('시간이 포함된 Excel 날짜는 ISO 일시 문자열로 입력해 주세요.');
            return text.slice(0, 10);
        }
        if (cell.type === 'number')
            throw new Error('날짜 서식 또는 ISO 날짜 문자열이 필요합니다.');
        if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text))
            throw new Error('모호한 날짜입니다. YYYY-MM-DD 또는 ISO 일시로 입력해 주세요.');
    }
    if (field.options && !field.options.includes(text))
        throw new Error(`허용 값: ${field.options.join(', ')}`);
    return text;
}
export function planRows(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, sheet: ParsedSheet, headerRow: number, mapping: Mapping[], choices: RowChoice[], privatePrice: boolean): PlannedRow[] {
    checkMapping(mapping, privatePrice);
    authorize(s, p, 'product.edit', productContextScope(contextId, 'import'), clock);
    const context = s.get('context', contextId)!;
    if (!Number.isSafeInteger(headerRow) || headerRow < 1)
        fail('VALIDATION', 422, '헤더 행을 선택해 주세요.');
    const data = sheet.rows.filter(r => r.row > headerRow);
    if (data.length > importLimits.rows || data.some(r => r.cells.some(c => c.column > 100)))
        fail('RESOURCE_LIMIT', 422, '선택한 자료는 5,000행·100열 이하이어야 합니다.');
    if (!data.length)
        fail('VALIDATION', 422, '헤더 다음에 반영할 행이 없습니다.');
    if (choices.some(c => !data.some(r => r.row === c.row)) || new Set(choices.map(c => c.row)).size !== choices.length)
        fail('VALIDATION', 422, '행 선택을 확인해 주세요.');
    const mergeRows = sheet.mergedRanges.map(range => range.split(':').map(a => Number(a.replace(/[A-Z]+/, '')))).filter(([a, b = a]) => b >= headerRow && a <= Math.max(...data.map(r => r.row)));
    const seen = new Map<string, number[]>();
    const plans = data.map(row => {
        const raw: Record<string, string> = {}, normalized: PreviewRow['normalized'] = {}, errors: ImportError[] = [];
        const error = (code: string, message: string, field: string | null = null, column: number | null = null) => errors.push({ code, message, field, column });
        const selected = choices.find(c => c.row === row.row), choice = selected?.action;
        if (choice && !['new', 'update', 'skip'].includes(choice))
            fail('VALIDATION', 422, '행 동작을 확인해 주세요.');
        if (mergeRows.some(([a, b = a]) => a <= row.row && b >= row.row) || mergeRows.some(([a, b = a]) => a <= headerRow && b >= headerRow))
            error('MERGED_CELL', '헤더나 데이터의 병합 셀을 해제해 주세요.');
        for (const cell of row.cells)
            if (cell.error)
                error(cell.error, '수식 또는 지원하지 않는 셀이 포함되어 있습니다.', null, cell.column);
        for (const m of mapping) {
            const field = importFields.find(f => f.key === m.field)!, cell = row.cells.find(c => c.column === m.column);
            raw[field.key] = cell?.text ?? '';
            if (!cell || cell.type === 'empty' || cell.text === '')
                continue;
            try {
                normalized[field.key] = valueOf(cell, field);
            }
            catch (e) {
                error('CELL_INVALID', e instanceof Error ? e.message : '입력을 확인해 주세요.', field.key, m.column);
            }
        }
        const code = typeof normalized['common.code'] === 'string' ? normalized['common.code'].trim() : '';
        if (normalized.contextKey !== contextId)
            error('CONTEXT_MISMATCH', '모든 행의 컨텍스트 키가 선택한 컨텍스트와 일치해야 합니다.', 'contextKey');
        if (normalized.brandId !== undefined && normalized.brandId !== context.data.brandId)
            error('BRAND_MISMATCH', '선택한 컨텍스트의 브랜드 ID와 일치해야 합니다.', 'brandId');
        if (!code)
            error('CODE_REQUIRED', '제품 코드를 입력해 주세요.', 'common.code');
        else {
            const key = normalizeProductCode(code);
            seen.set(key, [...(seen.get(key) ?? []), row.row]);
        }
        const cp = code ? s.list('contextProduct', contextId).find(cp => cp.data.normalizedCode === normalizeProductCode(code)) : null, r = cp ? resolveProduct(s, p, contextId, cp.data.productId, clock, true) : null;
        const action = choice ?? (r ? 'update' : 'new');
        if (action === 'new' && r || action === 'update' && !r)
            error('ACTION_MISMATCH', '신규/업데이트 선택과 기존 제품 코드가 일치하지 않습니다.');
        let common = r ? commonDTO(r.common.data.common) : blankCommon(), local = r ? contextDTO(r.local.data.fields) : blankContext();
        const retailRoot = r ? s.list('retailPrice', contextId).find(x => x.data.contextProductId === r.relation.id) : null;
        // Authorize BEFORE even looking up private roots, revisions, or values.
        if (privatePrice)
            authorize(s, p, 'price.read', { ...productContextScope(contextId, 'import'), requiresInternalPrice: true }, clock);
        const internalRoot = privatePrice && r ? s.list('internalPrice', contextId).find(x => x.data.contextProductId === r.relation.id) : null;
        const oldRetail = retailRoot?.data.currentVersionId ? s.get('retailPriceVersion', retailRoot.data.currentVersionId) : null, oldInternal = internalRoot?.data.currentVersionId ? s.get('internalPriceVersion', internalRoot.data.currentVersionId) : null;
        let retail = oldRetail ? retailDTO(oldRetail.data.fields) : blankRetailPrice(), internal = oldInternal ? internalDTO(oldInternal.data.fields) : blankInternalPrice();
        const changed = { common: !r, local: !r, retail: false, internal: false };
        const clear = selected?.clearFields ?? [];
        if (!Array.isArray(clear) || clear.some(k => !mapping.some(m => m.field === k) || ['contextKey', 'brandId', 'common.code', 'common.name'].includes(k)))
            error('CLEAR_INVALID', '명시적 비우기는 매핑된 선택 필드에만 사용할 수 있습니다.');
        for (const key of clear) {
            const field = importFields.find(f => f.key === key);
            if (!field)
                continue;
            normalized[key] = field.nullable ? null : field.type === 'boolean' ? false : field.type === 'enum' ? 'unknown' : '';
        }
        for (const [key, value] of Object.entries(normalized)) {
            const [group, ...rest] = key.split('.');
            if (group === 'common' && ['localName', 'localNameLanguage'].includes(rest[0]))
                continue;
            if (group === 'common' || group === 'local' || group === 'retail' || group === 'internal') {
                const object = { common, local, retail, internal }[group];
                setValue(object, rest.join('.'), value);
                changed[group] = true;
            }
        }
        if (normalized['common.localName'] !== undefined || normalized['common.localNameLanguage'] !== undefined) {
            const language = normalized['common.localNameLanguage'], name = normalized['common.localName'];
            if (typeof language !== 'string' || !language || typeof name !== 'string' || !name)
                error('LOCAL_NAME_PAIR', '공통 현지표기의 언어와 이름을 함께 입력해 주세요.');
            else {
                common.localNames = [...common.localNames.filter(n => n.language !== language), { language, name }];
                changed.common = true;
            }
        }
        try {
            common = commonInput(common);
            local = contextInput(local);
            validateProductProject(s, p, contextId, local, clock);
            if (changed.retail)
                retail = retailInput(retail);
            if (changed.internal)
                internal = internalInput(internal);
        }
        catch (e) {
            error('ROW_INVALID', e instanceof AuthError && e.status === 422 ? e.message : '상품 정보 또는 연결 범위를 확인해 주세요.');
        }
        return { preview: { row: row.row, action, raw, normalized, errors, visibleContexts: r ? s.list('contextProduct').filter(cp => cp.data.productId === r.product.id && decide(s, p, 'product.read', productContextScope(cp.contextId!, r.product.id), clock).allowed).map(cp => { const c = s.get('context', cp.contextId!)!; return { id: c.id, country: c.data.country, retailer: c.data.retailer, brand: c.data.brand }; }) : [], target: r ? { productId: r.product.id, contextProductId: r.relation.id, commonRevision: r.product.revision, contextRevision: r.relation.revision, retailRevision: retailRoot?.revision ?? 0, ...privatePrice ? { internalRevision: internalRoot?.revision ?? 0 } : {} } : null }, common, local, retail: changed.retail ? retail : null, internal: changed.internal ? internal : null, changed };
    });
    for (const plan of plans) {
        const code = plan.preview.normalized['common.code'];
        if (typeof code === 'string' && (seen.get(normalizeProductCode(code))?.length ?? 0) > 1)
            plan.preview.errors.push({ code: 'DUPLICATE_CODE', message: '같은 컨텍스트·제품 코드가 파일 안에서 중복됩니다. 건너뛰기 행도 먼저 수정해 주세요.', column: null, field: 'common.code' });
    }
    return plans;
}
