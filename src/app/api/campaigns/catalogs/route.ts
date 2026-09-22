import { route, json } from '@/server/http/identity';
import { CampaignService } from '@/server/campaigns/service';
import { query } from '@/server/campaigns/query';
export const runtime = 'nodejs';
export async function GET(request: Request) { return (await route(request, async (s, t) => { const q = query(request, ['context'], ['context']); return json(await new CampaignService(s).catalogs(t, q.get('context')!)); })); }
