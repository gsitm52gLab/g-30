import { route, json } from '@/server/http/identity';
import { query } from '@/server/ai-input/http';
import { AiReviewService } from '@/server/ai-review/service';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => { const q = query(request, ['versionId']); return json(await new AiReviewService(i).workspace(t, (await c.params).id, q.get('versionId') ?? undefined)); })); }
