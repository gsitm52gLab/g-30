import { route, json } from '@/server/http/identity';
import { AiAssets, assetDTO } from '@/server/ai-input/assets';
import { binary } from '@/server/ai-input/http';
import { storageAction, requestRange, rangeResponse } from '@/server/imports/storage-http';
import { STORAGE_LIMITS } from '@/domain/storage/types';
export const runtime='nodejs';
export async function GET(request:Request,c:{params:Promise<{id:string}>}) { return route(request,(i,t)=>storageAction(async()=>{
 const service=new AiAssets(i), id=(await c.params).id;
 if(i.repo.mode !== 'supabase') { const r=await service.download(t,id); return binary(r.bytes,r.metadata.filename,r.metadata.mime); }
 const row=await service.storage.metadata(t,id), dto=assetDTO(row), metadata={...dto,name:dto.filename,etag:`"${dto.sha256}"`,chunkBytes:STORAGE_LIMITS.chunkBytes,downloadUrl:dto.url};
 if(new URL(request.url).searchParams.get('metadata')==='1') return json(metadata);
 const range=requestRange(request,metadata.bytes,metadata.etag), r=await service.storage.chunk(t,id,range.start,range.end);
 return rangeResponse(r.bytes,metadata,range.start,range.end);
 })); }
