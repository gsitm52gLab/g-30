import { route, json, readBody } from '@/server/http/identity';
import { SchedulingService } from '@/server/scheduling/service';
export const runtime = 'nodejs';
export function GET(request: Request) { return route(request, async (s, t) => { const q = new URL(request.url).searchParams; return json(await new SchedulingService(s).list(t, q.get('context') ?? '', { taskId: q.get('task') ?? undefined, kind: q.get('kind') ?? undefined, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined })); }); }
export function POST(request: Request) { return route(request, async (s, t) => json(await new SchedulingService(s).command(t, await readBody(request, ['command', 'contextId', 'scheduleId', 'expectedRevision', 'content', 'reason', 'idempotencyKey'], 131072)))); }
