import { route, json, readBody } from '@/server/http/identity';
import { NotificationService } from '@/server/notifications/service';
export const runtime = 'nodejs';
export async function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await context.params; return (await route(request, async (s, t) => { await readBody(request, []); return json(await new NotificationService(s).retry(t, id)); })); }
