import { route, json } from '@/server/http/identity';
import { AuditService } from '@/server/audit/service';
export const runtime = 'nodejs';
export async function GET(request: Request) { return route(request, async (s, t) => json(await new AuditService(s).list(t, new URL(request.url).searchParams))); }
