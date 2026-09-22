import { notFound, redirect } from 'next/navigation';
import { identity, currentToken } from '@/server/auth/runtime';
import { CompletionService } from '@/server/completion/service';
import { AuthError } from '@/server/auth/errors';
import { StorageFailure } from '@/components/workspace';
import { CompletionSurface } from '@/features/completion/surface';
export const dynamic = 'force-dynamic';
export default async function CompletionPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await params; const initial = await (await (async () => { const service = await identity(), token = await currentToken(); const me = await service.me(token), data = await new CompletionService(service).workspace(token, id); return { actorId: me.user.id, data }; })()).catch(e => { if (e instanceof AuthError) {
    if (e.status === 401)
        redirect('/login');
    if (e.status === 403 || e.status === 404)
        notFound();
} return null; }); if (!initial)
    return <StorageFailure />; return <CompletionSurface key={JSON.stringify([initial.actorId, initial.data.contextId, id])} actorId={initial.actorId} initial={initial.data}/>; }
