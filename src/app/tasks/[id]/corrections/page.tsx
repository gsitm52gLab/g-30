import { notFound, redirect } from 'next/navigation';
import { identity, currentToken } from '@/server/auth/runtime';
import { CorrectionService } from '@/server/corrections/service';
import { AuthError } from '@/server/auth/errors';
import { StorageFailure } from '@/components/workspace';
import { CorrectionSurface } from '@/features/corrections/surface';
export const dynamic = 'force-dynamic';
export default async function CorrectionsPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    const initial = await new CorrectionService(await identity()).workspace(await currentToken(), id).catch(e => { if (e instanceof AuthError) {
        if (e.status === 401)
            redirect('/login');
        if (e.status === 403 || e.status === 404)
            notFound();
    } return null; });
    if (!initial)
        return <StorageFailure />;
    return <CorrectionSurface key={JSON.stringify([initial.actorId, initial.contextId, id])} initial={initial}/>;
}
