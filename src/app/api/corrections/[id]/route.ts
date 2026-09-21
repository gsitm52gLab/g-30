import { route,json } from '@/server/http/identity';
import { CorrectionService } from '@/server/corrections/service';
import { fail } from '@/server/auth/errors';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(s,t)=>{if(new URL(request.url).search)fail('VALIDATION',422,'정확한 공개 묶음 주소를 확인해 주세요.');return json(await new CorrectionService(s).detail(t,(await c.params).id));});}
