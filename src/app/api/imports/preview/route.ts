import { route, json, readBody } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { previewInput } from '@/domain/imports/validate';
import { storageAction } from '@/server/imports/storage-http';
export async function POST(request: Request) { return route(request,(identity,token)=>storageAction(async()=>{const result=await new ImportService(identity).preview(token,previewInput(await readBody(request,['sourceId','sheetId','headerRow','mapping','choices'],2*1024*1024)));return json(identity.repo.mode==='supabase'?{id:result.id}:result,201);})); }
