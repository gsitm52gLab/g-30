import { route, json } from '@/server/http/identity';
import { AiAssets } from '@/server/ai-input/assets';
import { query, uploadBody } from '@/server/ai-input/http';
import { visibility } from '@/domain/ai-input/validate';
export const runtime = 'nodejs';
export async function POST(request: Request) { return route(request, async (i, t) => { const q = query(request, ['contextId', 'visibility'], ['contextId', 'visibility']), v = visibility(q.get('visibility')), service = new AiAssets(i); await service.check(t, q.get('contextId')!, v); const body = await uploadBody(request); return json(await service.upload(t, q.get('contextId')!, v, body.key, body.file)); }); }
