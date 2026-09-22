import { route,json,readBody } from '@/server/http/identity';
import { AiProviderService } from '@/server/ai-provider/service';
export const runtime='nodejs';
export function POST(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(i,t)=>json(await new AiProviderService(i).retry(t,(await c.params).id,await readBody(request,['expectedRevision','idempotencyKey','acknowledgeUnknown','restartConfiguration']))));}
