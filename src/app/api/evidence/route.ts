import { route, json, readBody } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
export async function GET(request: Request) { return (await route(request, async (identity, token) => { const q = new URL(request.url).searchParams; return json(await new EvidenceService(identity).list(token, q.get('context') ?? '', q.get('productId') ?? undefined)); })); }
export async function POST(request: Request) { return (await route(request, async (identity, token) => json(await new EvidenceService(identity).register(token, await readBody(request, ['contextId', 'source', 'metadata', 'productIds', 'idempotencyKey'], 262144)), 201))); }
