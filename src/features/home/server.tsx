import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { identity, currentToken } from '@/server/auth/runtime';
import { HomeService, homeQuery } from '@/server/home/service';
import { AuthError } from '@/server/auth/errors';
import type { Search } from '@/server/workspace';
export async function homePage(searchParams: Search) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) { if (Array.isArray(v)) for (const item of v) params.append(k, item); else if (v !== undefined) params.set(k, v); }
  const data = await new HomeService(await identity()).read(await currentToken(), homeQuery(params));
  const rawView = params.get('view');
  const view: 'list' | 'kanban' | 'timeline' = rawView === 'kanban' || rawView === 'timeline' ? rawView : 'list';
  return { data, view };
}
export function homeFailure(error: unknown) {
  if (error instanceof AuthError && error.status === 401) redirect('/login');
  if (error instanceof AuthError && [403,404].includes(error.status)) return 'denied' as const;
  if (error instanceof AuthError && error.status === 422) return 'invalid' as const;
  return 'unavailable' as const;
}
export function HomeFailure({ state }: { state: ReturnType<typeof homeFailure> }) {
  return <section role="alert"><h1>{state === 'denied' ? '이 범위를 조회할 권한이 없습니다' : state === 'invalid' ? '조회 조건을 확인해 주세요' : '업무 현황을 불러오지 못했습니다'}</h1><p>{state === 'unavailable' ? '저장소 조회에 실패했습니다. 빈 목록이나 0건을 뜻하지 않습니다.' : '현재 계정에 허용된 범위로 돌아가세요.'}</p><Link prefetch={false} className="button" href="/">현재 권한으로 홈 다시 읽기</Link><p>선택한 범위를 유지하려면 브라우저의 새로고침으로 다시 시도할 수 있습니다.</p></section>;
}
