import { route, json } from '@/server/http/identity';
import { AiReviewService } from '@/server/ai-review/service';
export const runtime = 'nodejs';
export function GET(request: Request, c: { params: Promise<{ id: string }> }) { return route(request, async (i, t) => json(await new AiReviewService(i).raw(t, (await c.params).id))); }
