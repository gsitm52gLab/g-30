import { route, json, readBody } from '@/server/http/identity';
import { NotificationService } from '@/server/notifications/service';
import { ids } from '@/domain/tasks/validate';
export const runtime = 'nodejs';
export async function POST(request: Request) { return (await route(request, async (s, t) => { const body = await readBody(request, ['contextId']); return json(await new NotificationService(s).sync(t, ids([body.contextId])[0])); })); }
