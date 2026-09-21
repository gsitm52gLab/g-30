import { route,json } from '@/server/http/identity';
import { AiInputService } from '@/server/ai-input/service';
import { query } from '@/server/ai-input/http';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(i,t)=>json(await new AiInputService(i).detail(t,(await c.params).id,query(request,['versionId']).get('versionId')??undefined)));}
