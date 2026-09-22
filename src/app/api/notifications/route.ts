import { route, json } from '@/server/http/identity';
import { NotificationService } from '@/server/notifications/service';
export const runtime = 'nodejs';
export async function GET(request: Request) { return (await route(request, async (s, t) => json(await new NotificationService(s).list(t, new URL(request.url).searchParams.get('context') ?? '')))); }
