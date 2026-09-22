import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { storageAction, authorizedPrivateJsonResponse } from '@/server/imports/storage-http';
export const runtime='nodejs';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>{
 const id=(await c.params).id, load=()=>new ImportService(i).source(t,id);
 if(i.repo.mode !== 'supabase')return json(await load());
 return authorizedPrivateJsonResponse(request,load,id,`/api/imports/source/${encodeURIComponent(id)}`);
 })); }
