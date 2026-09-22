import { route, json } from '@/server/http/identity';
import { AiAssetStorage } from '@/server/ai-input/storage';
import { storageAction } from '@/server/imports/storage-http';
export const runtime = 'nodejs';
type Params = { params: Promise<{id:string}> };
export async function GET(request:Request,c:Params) { return route(request,(i,t)=>storageAction(async()=>json(await new AiAssetStorage(i).status(t,(await c.params).id)))); }
export async function POST(request:Request,c:Params) { return route(request,(i,t)=>storageAction(async()=>json(await new AiAssetStorage(i).finalize(t,(await c.params).id)))); }
