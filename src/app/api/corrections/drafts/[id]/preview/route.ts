import { route, json } from '@/server/http/identity';
import { CorrectionService } from '@/server/corrections/service';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (s, t) => json(await new CorrectionService(s).preview(t, (await c.params).id))); }
