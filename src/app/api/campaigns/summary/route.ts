import { route,json } from '@/server/http/identity';
import { CampaignService } from '@/server/campaigns/service';
import { query } from '@/server/campaigns/query';
export const runtime='nodejs';
export function GET(request:Request){return route(request,async(s,t)=>{const q=query(request,['taskId'],['taskId']);return json(await new CampaignService(s).remainder(t,q.get('taskId')!));});}
