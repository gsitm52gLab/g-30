import { route, json } from '@/server/http/identity';
import { CompletionService } from '@/server/completion/service';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (s, t) => json(await new CompletionService(s).external(t, (await c.params).id))); }
