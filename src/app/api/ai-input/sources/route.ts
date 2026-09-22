import { route, json } from '@/server/http/identity';
import { AiInputService } from '@/server/ai-input/service';
import { query } from '@/server/ai-input/http';
export const runtime = 'nodejs';
export async function GET(request: Request) { return (await route(request, async (i, t) => json(await new AiInputService(i).picker(t, query(request, ['contextId'], ['contextId']).get('contextId')!)))); }
