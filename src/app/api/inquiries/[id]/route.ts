import { route,json,readBody } from '@/server/http/identity';
import { InquiryService } from '@/server/inquiries/service';
import { inquiryLimits } from '@/domain/inquiries/validate';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export function GET(request:Request,c:Context){return route(request,async(s,t)=>json(await new InquiryService(s).detail(t,(await c.params).id)));}
export function POST(request:Request,c:Context){return route(request,async(s,t)=>json(await new InquiryService(s).command(t,(await c.params).id,await readBody(request,['command','idempotencyKey','expectedRevision','expectedQuestionRevision','questionId','title','content','kind','state','reason','externalWait','taskId','throughMessageId'],inquiryLimits.requestBytes))));}
