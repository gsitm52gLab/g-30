export const commonMenus = [
  ['/', '홈'], ['/tasks', '신규 입점·스팟 업무'], ['/products', '상품정보'], ['/projects', '입점 프로젝트'],
  ['/materials', '자료함·제출표'], ['/notices', '공지·가이드'], ['/inquiries', '문의'], ['/campaigns', 'PR·행사'],
  ['/schedule', '일정'], ['/notifications', '알림'], ['/search', '검색·이력'], ['/ai-review', '약기법 사전검토'], ['/ai-input', '검토 문안·파일'],
] as const;
export function navigationMenus(role: 'gsg' | 'brand' | null) { return role === 'gsg' ? [...commonMenus, ['/contexts', '운영 설정 · 컨텍스트·회원'] as const] : [...commonMenus]; }
