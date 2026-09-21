import type { IdentityService } from '@/server/auth/service';
import { FileService,sourceReference } from '@/server/files/service';
import { fail,unavailable } from '@/server/auth/errors';
import { correctionTask } from './access';
import { batchContent } from './projection';
import { exactTarget } from './targets';
export class CorrectionFiles {
    constructor(public identity:IdentityService,private directory?:string){}
    async download(token:string|undefined,id:string,query:URLSearchParams){
        if([...query.keys()].some(k=>!['batchVersionId','itemKey','reflectionId','mode'].includes(k))||[...query.keys()].some(k=>query.getAll(k).length!==1))fail('VALIDATION',422,'정확한 수정항목과 파일 참조를 지정해 주세요.');
        const batchId=query.get('batchVersionId'),key=query.get('itemKey'),reflectionId=query.get('reflectionId'),mode=query.get('mode')??'download';
        if(!batchId||!key||query.has('reflectionId')&&!reflectionId||!['download','original','preview'].includes(mode))fail('VALIDATION',422,'정확한 수정항목과 파일 참조를 지정해 주세요.');
        const authorize=()=>this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),b=s.get('correctionBatch',batchId);if(!b)unavailable();correctionTask(s,p,b.data.taskId,this.identity.clock);const item=batchContent(b).items.find(i=>i.key===key);if(!item)unavailable();let target=item.target;if(reflectionId){const r=s.get('correctionReflection',reflectionId);if(!r||r.data.batchVersionId!==b.id||r.data.itemKey!==key)unavailable();target=r.data.target;}exactTarget(s,p,target,this.identity.clock);if(!target.fileVersionIds.includes(id))unavailable();const file=s.get('fileVersion',id);if(!file)unavailable();return sourceReference(file);});
        const reference=await authorize(),result=await new FileService(this.identity,this.directory).download(token,id,reference,mode as 'download'|'original'|'preview');await authorize();return result;
    }
}
