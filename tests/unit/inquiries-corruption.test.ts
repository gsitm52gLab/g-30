import { TaskService } from '@/server/tasks/service';
import { blankContent } from '@/domain/tasks/types';
import { afterEach,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { openDatabase,migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { policyFixture,tokenFor,NOW } from '../fixtures/policy';
import { InquiryService } from '@/server/inquiries/service';
const A='ctx-jp-a-luna',brand=tokenFor('user-team'),gsg=tokenFor('user-gsg'),marker='G09_STORED_UNKNOWN';
for(const mode of ['mock','sqlite'] as const)describe(`${mode} G09 saved projection boundaries`,()=>{
    let repo:RecordRepository,service:InquiryService,id:string;
    async function setup(){repo=mode==='mock'?createMockRepository(()=>NOW):(()=>{const db=openDatabase(':memory:',true);migrate(db);return createSqliteRepository(db,()=>NOW);})();service=new InquiryService(await policyFixture(repo));const d=await service.createDraft(brand,{contextId:A,taskId:null,idempotencyKey:randomUUID()});id=d.conversationId;await service.command(brand,id,{command:'publish_first',title:'Valid title',expectedRevision:1,content:{clientMessageId:randomUUID(),body:'Valid body',fileVersionIds:[]},idempotencyKey:randomUUID()});}
    afterEach(()=>repo?.close());
    it('valid unknown extensions never escape recursively; raw originals remain unchanged by detail/list/events',async()=>{
        await setup();let questionId='';await repo.transaction(s=>{const c=s.get('conversation',id)!;s.update('conversation',id,c.revision,{...c.data,extra:{marker}} as unknown as typeof c.data);const q=s.list('inquiryQuestion').find(q=>q.data.conversationId===id)!;questionId=q.id;s.update('inquiryQuestion',q.id,q.revision,{...q.data,state:'external_waiting',extra:marker,externalWait:{counterparty:'Valid counterparty',responsibleUserId:'user-gsg',nextCheckDate:'2026-10-05',timezone:'Asia/Tokyo',sentAt:null,latestResult:'Valid result',secret:{marker}}} as typeof q.data);s.create('inquiryMessage',{id:randomUUID(),contextId:A,data:{conversationId:id,questionId:null,clientMessageId:randomUUID(),authorId:'user-gsg',body:'Valid extra message',kind:'comment',visibility:'public',fileVersionIds:[],createdAt:NOW,sequence:3,privateUnknown:{marker}} as never});});
        const before=await repo.get('conversation',id),q=await repo.get('inquiryQuestion',questionId),messages=await repo.list('inquiryMessage');
        const d=await service.detail(brand,id);expect(JSON.stringify(d)).not.toContain(marker);expect(JSON.stringify(d)).toContain('Valid counterparty');expect(JSON.stringify(await service.list(brand,new URLSearchParams({context:A})))).not.toContain(marker);
        if(d.phase!=='active')throw Error('active');expect(JSON.stringify(await service.events(brand,id,new URLSearchParams({after:d.cursor})))).not.toContain(marker);
        expect(await repo.get('conversation',id)).toEqual(before);expect(await repo.get('inquiryQuestion',questionId)).toEqual(q);expect(await repo.list('inquiryMessage')).toEqual(messages);
    });
    it('known malformed title fails safe503, cannot coerce an object into public text',async()=>{await setup();await repo.transaction(s=>{const c=s.get('conversation',id)!;s.update('conversation',id,c.revision,{...c.data,title:{marker}} as never);});await expect(service.detail(brand,id)).rejects.toMatchObject({status:503});await expect(service.list(gsg,new URLSearchParams({context:A}))).rejects.toMatchObject({status:503});});
    it('known malformed external metadata fails safe503 and stored message kind arrays do not reach DTO',async()=>{
        await setup();await repo.transaction(s=>{s.create('inquiryMessage',{id:randomUUID(),contextId:A,data:{conversationId:id,questionId:null,clientMessageId:randomUUID(),authorId:'user-gsg',body:'Known body',kind:['comment'],visibility:'public',fileVersionIds:[],createdAt:NOW,sequence:3}} as never);});
        await expect(service.detail(brand,id)).rejects.toMatchObject({status:503});
    });
    it('known malformed message visibility cannot silently disappear from an authorized conversation',async()=>{
        await setup();await repo.transaction(s=>{s.create('inquiryMessage',{id:randomUUID(),contextId:A,data:{conversationId:id,questionId:null,clientMessageId:randomUUID(),authorId:'user-gsg',body:'saved body',kind:'comment',visibility:['public'],fileVersionIds:[],createdAt:NOW,sequence:3}} as never);});
        await expect(service.detail(brand,id)).rejects.toMatchObject({status:503});
    });
    it('known malformed durable event lane requires safe failure rather than skipping missed data',async()=>{
        await setup();const d=await service.detail(brand,id);if(d.phase!=='active')throw Error('active');
        await repo.transaction(s=>{s.create('inquiryEvent',{id:randomUUID(),contextId:A,data:{conversationId:id,lane:['public'],kind:'message',position:3,recordId:d.messages[0].id,at:NOW}} as never);});
        await expect(service.events(brand,id,new URLSearchParams({after:d.cursor}))).rejects.toMatchObject({status:503});
    });
    it('current private task details do not leak via a later brand command or same-intent replay',async()=>{
        await setup();const content={...blankContent(),title:'실제 비공개 업무',description:'합성 요청',deadline:{...blankContent().deadline,responsibleUserId:'user-gsg'}};const taskId=(await new TaskService(service.identity).create(gsg,{targets:[{contextId:A,ownerId:'user-gsg',assigneeId:'user-team',coAssigneeIds:[],productIds:[]}],category:'spot',content,idempotencyKey:randomUUID()})).ids[0];const d=await service.detail(gsg,id);if(d.phase!=='active')throw Error('active');
        await service.command(gsg,id,{command:'link_task',taskId,expectedRevision:d.revision,idempotencyKey:randomUUID()});
        const command={command:'message',kind:'comment',questionId:null,content:{clientMessageId:randomUUID(),body:'comment',fileVersionIds:[]},idempotencyKey:randomUUID()};
        expect((await service.command(brand,id,command)).taskId).toBeNull();expect((await service.command(brand,id,command)).taskId).toBeNull();expect(JSON.stringify(await service.detail(brand,id))).not.toContain(taskId);
    });
});
