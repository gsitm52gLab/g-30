import { route, json } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
export function GET(request: Request) { return route(request, async (identity, token) => { const q = new URL(request.url).searchParams; return json(await new EvidenceService(identity).table(token, q.get('context') ?? '', q.get('history') === '1')); }); }
