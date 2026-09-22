import type { Search } from '@/server/workspace';
import { HomeSurface } from '@/features/home/surface';
import { homePage, homeFailure, HomeFailure } from '@/features/home/server';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Search }) {
  const result = await homePage(searchParams).catch(homeFailure);
  if (typeof result === 'string') return <HomeFailure state={result}/>;
  return <HomeSurface data={result.data} view={result.view}/>;
}
