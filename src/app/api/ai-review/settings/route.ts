import { route, json, readBody } from '@/server/http/identity';
import { AiProviderService } from '@/server/ai-provider/service';
export const runtime = 'nodejs';
export async function GET(request: Request) { return (await route(request, async (i, t) => json(await new AiProviderService(i).settings(t, new URL(request.url).searchParams.get('contextId') ?? '')))); }
export async function POST(request: Request) { return (await route(request, async (i, t) => { const raw = await readBody(request, ['contextId', 'enabled', 'expectedRevision', 'idempotencyKey']); const { contextId, ...body } = raw; return json(await new AiProviderService(i).changeSettings(t, typeof contextId === 'string' ? contextId : '', body)); })); }
