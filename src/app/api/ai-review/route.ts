import { route, json } from '@/server/http/identity';
import { query } from '@/server/ai-input/http';
import { AiReviewService } from '@/server/ai-review/service';
export const runtime = 'nodejs';
export async function GET(request: Request) { return route(request, async (i, t) => { const q = query(request, ['contextId'], ['contextId']); return json(await new AiReviewService(i).list(t, q.get('contextId')!)); }); }
