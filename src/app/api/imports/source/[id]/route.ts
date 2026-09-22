import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { storageAction } from '@/server/imports/storage-http';
export const runtime='nodejs';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>json(await new ImportService(i).source(t,(await c.params).id)))); }
