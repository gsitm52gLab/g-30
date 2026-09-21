import { object, str, enumValue } from '../tasks/validate';
import { fail } from '@/server/auth/errors';
import type { EvidenceMetadata, EvidenceSource } from './types';
export const id = (v: unknown) => str(v, 160, true);
function date(v: unknown): string | null {
    if (v === null || v === undefined || v === '')
        return null;
    const value = str(v, 10, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        fail('VALIDATION', 422, '날짜를 YYYY-MM-DD로 입력해 주세요.');
    return value;
}
export function metadataInput(value: unknown): EvidenceMetadata {
    const v = object(value, ['title', 'documentType', 'issuer', 'issuedAt', 'signedAt', 'statedValidFrom', 'statedValidTo', 'validityRaw', 'language', 'source']);
    const result = { title: str(v.title, 300, true), documentType: str(v.documentType, 120, true), issuer: str(v.issuer ?? '', 300), issuedAt: date(v.issuedAt), signedAt: date(v.signedAt), statedValidFrom: date(v.statedValidFrom), statedValidTo: date(v.statedValidTo), validityRaw: str(v.validityRaw ?? '', 2000), language: str(v.language ?? '', 80), source: str(v.source ?? '', 2000) };
    if (result.statedValidFrom && result.statedValidTo && result.statedValidFrom > result.statedValidTo)
        fail('VALIDATION', 422, '명시된 기간의 시작과 끝을 확인해 주세요.');
    return result;
}
export function sourceInput(value: unknown): EvidenceSource {
    const v = value as Record<string, unknown>, kind = enumValue(v?.kind, ['product_binding', 'submission', 'request']);
    if (kind === 'product_binding') {
        object(v, ['kind', 'productId', 'contextProductId', 'contextVersionId', 'bindingId', 'fileVersionId']);
        return { kind, productId: id(v.productId), contextProductId: id(v.contextProductId), contextVersionId: id(v.contextVersionId), bindingId: id(v.bindingId), fileVersionId: id(v.fileVersionId) };
    }
    if (kind === 'request') {
        object(v, ['kind', 'taskId', 'requestId', 'fileVersionId']);
        return { kind, taskId: id(v.taskId), requestId: id(v.requestId), fileVersionId: id(v.fileVersionId) };
    }
    object(v, ['kind', 'taskId', 'requestId', 'submissionId', 'requirementKey', 'productId', 'fileVersionId']);
    return { kind, taskId: id(v.taskId), requestId: id(v.requestId), submissionId: id(v.submissionId), requirementKey: v.requirementKey === null ? null : id(v.requirementKey), productId: v.productId === null ? null : id(v.productId), fileVersionId: id(v.fileVersionId) };
}
export function productIdsInput(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 500)
        fail('VALIDATION', 422, '적용 상품을 1~500개 선택해 주세요.');
    const ids = value.map(id);
    if (new Set(ids).size !== ids.length)
        fail('VALIDATION', 422, '적용 상품이 중복되었습니다.');
    return ids;
}
