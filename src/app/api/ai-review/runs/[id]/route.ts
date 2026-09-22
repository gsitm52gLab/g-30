import { route, json } from '@/server/http/identity';
import { AiReviewService } from '@/server/ai-review/service';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => json(await new AiReviewService(i).detail(t, (await c.params).id)))); }
