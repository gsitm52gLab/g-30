import type { Authority, Category, ResultIssue, Risk, ValidatedResult } from '@/domain/ai-review/types';

export const authorityLabels: Record<Authority, string> = {
  statute: '법령', official_notification: '공식 통지', industry_guidance: '업계 자율 지침',
};
export const categoryLabels: Record<Category, string> = {
  'YK-01': '맥락·누락', 'YK-02': '허위·과대 후보', 'YK-03': '권위 보증',
  'YK-05': '분류 혼용', 'YK-06': '효능 범위', 'YK-07': '잔주름 조건',
  'YK-09': '절대·최상급', 'YK-10': '이미지·후기·수치·랭킹',
  'YK-11': '안전성 보증', 'YK-12': '성분의 제품 효능 확대',
  'TR-01': '사전 번역 정렬', 'EV-01': '근거·평가자료 부족',
};
export const riskLabels: Record<Risk, string> = {
  low: '낮음', medium: '중간', high: '높음', unknown: '미확인',
};
export const resultLabels: Record<ValidatedResult['status'], string> = {
  candidates: '문제 후보 있음', no_candidates: '확인된 문제 후보 없음',
  unconfirmed: '추가 확인 필요', out_of_scope: '지원 범위 밖', unread: '원문 읽기 미확인',
};
export const quarantineLabels: Record<ResultIssue, string> = {
  QUOTE_UNCONFIRMED: '원문 인용·위치 확인 실패',
  CATEGORY_UNSUPPORTED: '지원하지 않는 후보 유형',
  FINDING_MALFORMED: '후보 형식 확인 실패',
};
export const limitationLabels: Record<ValidatedResult['limitations'][number], string> = {
  PARTIAL_EXTRACTION: '입력의 일부만 읽었습니다. 읽지 못한 범위는 별도로 확인해 주세요.',
  CORPUS_UNAVAILABLE: '사용할 근거 자료가 부족합니다. 근거 부족을 문제없음으로 처리하지 않습니다.',
  UNREVIEWED_TRANSLATION: '검수 전 한국어 번역이 포함되어 있습니다. 일본어 원문과 대조해 주세요.',
};
