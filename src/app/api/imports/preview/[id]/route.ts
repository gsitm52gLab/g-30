import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { storageAction, privateJsonResponse } from '@/server/imports/storage-http';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>{const id=(await c.params).id,page=Number(new URL(request.url).searchParams.get('page')??'1'),value=await new ImportService(i).readPreview(t,id,page);if(i.repo.mode !== 'supabase')return json(value);return privateJsonResponse(request,value,id,`/api/imports/preview/${encodeURIComponent(id)}?page=${page}`);})); }
