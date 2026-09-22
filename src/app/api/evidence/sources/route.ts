import { route, json } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
export async function GET(request: Request) { return (await route(request, async (identity, token) => json(await new EvidenceService(identity).sources(token, new URL(request.url).searchParams.get('context') ?? '')))); }
