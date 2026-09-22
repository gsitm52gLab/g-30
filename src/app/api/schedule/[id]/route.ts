import { route, json } from '@/server/http/identity';
import { SchedulingService } from '@/server/scheduling/service';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await context.params; return (await route(request, async (s, t) => json(await new SchedulingService(s).detail(t, id)))); }
