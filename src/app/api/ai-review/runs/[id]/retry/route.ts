import { route, json, readBody } from '@/server/http/identity';
import { AiProviderService } from '@/server/ai-provider/service';
export const runtime = 'nodejs';
export async function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => json(await new AiProviderService(i).retry(t, (await c.params).id, await readBody(request, ['expectedRevision', 'idempotencyKey', 'acknowledgeUnknown', 'restartConfiguration']))))); }
