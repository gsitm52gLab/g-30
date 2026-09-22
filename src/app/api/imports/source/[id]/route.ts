import { route } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { storageAction, privateJsonResponse } from '@/server/imports/storage-http';
export const runtime='nodejs';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>{const id=(await c.params).id;return privateJsonResponse(request,await new ImportService(i).source(t,id),id,`/api/imports/source/${encodeURIComponent(id)}`);})); }
