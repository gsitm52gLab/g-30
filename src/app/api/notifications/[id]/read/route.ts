import { route, json, readBody } from '@/server/http/identity';
import { NotificationService } from '@/server/notifications/service';
export const runtime = 'nodejs';
export async function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await context.params; return route(request, async (s, t) => json(await new NotificationService(s).read(t, id, await readBody(request, ['read', 'expectedRevision', 'idempotencyKey'])))); }
