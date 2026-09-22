import { route } from '@/server/http/identity';
import { query,binary } from '@/server/ai-input/http';
import { loadRequest } from '@/server/ai-input/sources';
import { fail } from '@/server/auth/errors';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string;index:string}>}){return route(request,async(i,t)=>{const p=await c.params,q=query(request,['versionId'],['versionId']);if(!/^[0-3]$/.test(p.index))fail('VALIDATION',422,'자료 순서를 확인해 주세요.');const r=await loadRequest(i,t,p.id,q.get('versionId')!);if(r.kind==='text')fail('NOT_FOUND',404,'자료를 찾을 수 없습니다.');const source=r.kind==='pdf'?[r.source][Number(p.index)]:r.sources[Number(p.index)];if(!source)fail('NOT_FOUND',404,'자료를 찾을 수 없습니다.');return binary(Buffer.from(source.bytes),source.filename,source.mime);});}
