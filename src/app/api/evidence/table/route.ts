import { route, json } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
export async function GET(request: Request) { return (await route(request, async (identity, token) => { const q = new URL(request.url).searchParams; return json(await new EvidenceService(identity).table(token, q.get('context') ?? '', q.get('history') === '1')); })); }
