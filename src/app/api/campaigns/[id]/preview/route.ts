import { route,json } from '@/server/http/identity';
import { CampaignService } from '@/server/campaigns/service';
import { query } from '@/server/campaigns/query';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(s,t)=>{query(request,[],[]);return json(await new CampaignService(s).preview(t,(await c.params).id));});}
