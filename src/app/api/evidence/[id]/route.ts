import { route, json, readBody } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Context) { return (await route(request, async (identity, token) => json(await new EvidenceService(identity).detail(token, (await context.params).id)))); }
export async function POST(request: Request, context: Context) { return (await route(request, async (identity, token) => json(await new EvidenceService(identity).command(token, (await context.params).id, await readBody(request, ['command', 'idempotencyKey', 'expectedRevision', 'source', 'metadata', 'productIds', 'versionId', 'linkId', 'expectedLinkRevision', 'status', 'reason'], 262144))))); }
