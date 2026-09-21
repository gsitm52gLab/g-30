import { route,json,readBody } from '@/server/http/identity';
import { CampaignService,campaignCommandKeys } from '@/server/campaigns/service';
import { query } from '@/server/campaigns/query';
export const runtime='nodejs';
export function GET(request:Request){return route(request,async(s,t)=>{const q=query(request,['context','taskId'],['context']);return json(await new CampaignService(s).list(t,q.get('context')!,q.get('taskId')??undefined));});}
export function POST(request:Request){return route(request,async(s,t)=>json(await new CampaignService(s).command(t,await readBody(request,campaignCommandKeys,2*1024*1024))));}
