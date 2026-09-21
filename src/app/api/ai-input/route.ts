import { route,json,readBody } from '@/server/http/identity';
import { AiInputService } from '@/server/ai-input/service';
import { query } from '@/server/ai-input/http';
export const runtime='nodejs';
export function GET(request:Request){return route(request,async(i,t)=>json(await new AiInputService(i).list(t,query(request,['contextId'],['contextId']).get('contextId')!)));}
export function POST(request:Request){return route(request,async(i,t)=>json(await new AiInputService(i).create(t,await readBody(request,['contextId','visibility','content','idempotencyKey'],100000))));}
