import { route, json, readBody } from '@/server/http/identity';
import { NoticeService } from '@/server/notices/service';
export const runtime = 'nodejs';
export function GET(request: Request) { return route(request, async (s, t) => { const q = new URL(request.url).searchParams; return json(await new NoticeService(s).list(t, q.get('context') ?? '', { q: q.get('q') ?? undefined, type: q.get('type') ?? undefined, state: q.get('state') ?? undefined })); }); }
export function POST(request: Request) { return route(request, async (s, t) => json(await new NoticeService(s).create(t, await readBody(request, ['contextId', 'content', 'idempotencyKey'], 65536)), 201)); }
