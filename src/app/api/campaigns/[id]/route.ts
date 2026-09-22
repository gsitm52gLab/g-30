import { route, json } from '@/server/http/identity';
import { CampaignService } from '@/server/campaigns/service';
import { query } from '@/server/campaigns/query';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (s, t) => { const q = query(request, ['versionId'], []); return json(await new CampaignService(s).detail(t, (await c.params).id, q.get('versionId') ?? undefined)); })); }
