import { route } from '@/server/http/identity';
import { CampaignFileService } from '@/server/campaigns/files';
import { query } from '@/server/campaigns/query';
import { fail } from '@/server/auth/errors';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(s,t)=>{const q=query(request,['versionId','submissionId','mode'],['versionId','submissionId']),mode=q.get('mode')??'download';if(!['original','download','preview'].includes(mode))fail('VALIDATION',422,'파일 동작을 확인해 주세요.');const {bytes,metadata}=await new CampaignFileService(s).download(t,(await c.params).id,q.get('versionId')!,q.get('submissionId')!,mode as 'original'|'download'|'preview');return new Response(bytes,{headers:{'Content-Type':metadata.mime,'Content-Length':String(bytes.length),'Content-Disposition':`${mode==='preview'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});});}
