import { route, json } from '@/server/http/identity';
import { ImportExports } from '@/server/imports/storage-export';
import { storageAction, requestRange, rangeResponse } from '@/server/imports/storage-http';
export const runtime='nodejs';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>{ const id=(await c.params).id, service=new ImportExports(i), metadata=await service.metadata(t,id); if(new URL(request.url).searchParams.get('metadata')==='1') return json(metadata); const range=requestRange(request,metadata.bytes,metadata.etag), r=await service.chunk(t,id,range.start,range.end); return rangeResponse(r.bytes,r.metadata,range.start,range.end); })); }
