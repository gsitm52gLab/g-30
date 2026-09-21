export interface ImportField {
    key: string;
    label: string;
    type: 'text' | 'identifier' | 'decimal' | 'boolean' | 'date' | 'enum';
    nullable: boolean;
    options?: readonly string[];
    privatePrice?: true;
}
const f = (key: string, label: string, type: ImportField['type'] = 'text', nullable = false, options?: readonly string[]): ImportField => ({ key, label, type, nullable, ...options ? { options } : {}, ...key.startsWith('internal.') ? { privatePrice: true as const } : {} });
export const importFields: readonly ImportField[] = [
    f('contextKey', '컨텍스트 키', 'identifier'), f('brandId', '브랜드 ID', 'identifier'), f('common.code', '제품 코드', 'identifier'), f('common.name', '상품명'), f('common.temporaryCode', '임시 코드', 'boolean'),
    f('common.localNameLanguage', '공통 현지표기 언어'), f('common.localName', '공통 현지표기'), f('common.category', '카테고리'), f('common.capacity.amount', '용량', 'decimal', true), f('common.capacity.unit', '용량 단위'), f('common.capacity.raw', '용량 원문'),
    f('common.variants.color', '색상'), f('common.variants.scent', '향'), f('common.variants.other', '기타 변형'), f('common.description', '제품 설명'), f('common.usage', '사용 방법'), f('common.originCountry', '원산지'), f('common.manufacturer', '제조사'), f('common.manufacturingDetails', '제조 정보'),
    f('common.ingredients.text', '전성분 원문'), f('common.ingredients.language', '전성분 언어'), f('common.ingredients.submittedAt', '전성분 제출일', 'date', true), f('common.ingredients.classification', '성분 분류', 'text', true),
    f('common.packaging.container', '용기'), f('common.packaging.packaging', '포장'), f('common.packaging.label', '라벨'), f('common.packaging.box', '박스'), f('common.packaging.itf', 'ITF', 'identifier'),
    f('local.localName', '현지 상품명'), f('local.sku', '현지 SKU', 'identifier'), f('local.jan', 'JAN', 'identifier'), f('local.registrationStatus', '등록 상태', 'enum', false, ['unknown', 'unregistered', 'in_progress', 'registered']), f('local.salesStatus', '판매 상태', 'enum', false, ['unknown', 'planned', 'selling', 'stopped']),
    f('local.launchDate.value', '출시일', 'date', true), f('local.launchDate.precision', '출시일 정밀도', 'enum', false, ['date', 'datetime']), f('local.launchDate.certainty', '출시일 확정 여부', 'enum', false, ['unknown', 'expected', 'confirmed']), f('local.launchDate.timezone', '출시 시간대', 'text', true), f('local.launchDate.source', '출시일 출처'), f('local.launchDate.raw', '출시일 원문'), f('local.projectId', '입점 프로젝트 ID', 'identifier', true),
    f('retail.amount', '소비자가', 'decimal', true), f('retail.currency', '소비자가 통화', 'text', true), f('retail.taxIncluded', '소비자가 세금 포함', 'enum', false, ['unknown', 'yes', 'no']), f('retail.effectiveFrom', '소비자가 적용 시작', 'date', true), f('retail.effectiveTo', '소비자가 적용 종료', 'date', true), f('retail.source', '소비자가 출처'),
    f('internal.supplyAmount', '내부 공급가', 'decimal', true), f('internal.currency', '내부 통화', 'text', true), f('internal.supplyRate', '내부 공급률', 'decimal', true), f('internal.rateUnit', '공급률 단위', 'enum', true, ['ratio', 'percent']), f('internal.rateBasis', '공급률 기준'), f('internal.taxIncluded', '내부 세금 포함', 'enum', false, ['unknown', 'yes', 'no']), f('internal.effectiveFrom', '내부 적용 시작', 'date', true), f('internal.effectiveTo', '내부 적용 종료', 'date', true), f('internal.source', '내부 가격 출처')
];
export const publicImportFields = importFields.filter(f => !f.privatePrice);
