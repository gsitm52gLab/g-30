import { route, json, readBody } from '@/server/http/identity';
import { AiReviewService } from '@/server/ai-review/service';
export const runtime = 'nodejs';
export async function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => json(await new AiReviewService(i).review(t, (await c.params).id, await readBody(request, ['findingId', 'expectedRevision', 'decision', 'reason', 'editedSuggestion', 'idempotencyKey'], 32768))))); }
