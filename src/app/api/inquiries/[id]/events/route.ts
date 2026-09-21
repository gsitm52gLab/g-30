import { route,json } from '@/server/http/identity';
import { InquiryService } from '@/server/inquiries/service';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(s,t)=>json(await new InquiryService(s).events(t,(await c.params).id,new URL(request.url).searchParams)));}
