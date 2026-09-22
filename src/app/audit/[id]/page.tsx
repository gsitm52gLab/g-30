import { loadPage } from '@/features/search/server';
import { SearchScreen } from '@/features/search/screen';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams, params }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
    params: Promise<{
        id: string;
    }>;
}) { const initial = await loadPage('audit-detail', await searchParams, (await params).id); return <SearchScreen key={`${initial.scope?.actor.id}:${initial.query}:${initial.id}`} initial={initial}/>; }
