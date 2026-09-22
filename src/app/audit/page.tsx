import { loadPage } from '@/features/search/server';
import { SearchScreen } from '@/features/search/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) { const initial = await loadPage('audit', await searchParams); return <SearchScreen key={`${initial.scope?.actor.id}:${initial.context}`} initial={initial}/>; }
