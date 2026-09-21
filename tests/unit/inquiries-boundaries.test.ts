import { afterEach,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate,openDatabase } from '@/server/db/database';
import { IdentityService } from '@/server/auth/service';
import { policyFixture,tokenFor,NOW } from '../fixtures/policy';
import { InquiryService } from '@/server/inquiries/service';
import { InquiryFiles } from '@/server/inquiries/files';
import { FileService } from '@/server/files/service';
const A='ctx-jp-a-luna',brand=tokenFor('user-team'),gsg=tokenFor('user-gsg'),admin=tokenFor('user-admin');
for(const mode of ['mock','sqlite'] as const)describe(`${mode} inquiry current authorization boundaries`,()=>{
    let repo:RecordRepository,identity:IdentityService,service:InquiryService,dir:string;
    async function setup(){repo=mode==='mock'?createMockRepository(()=>NOW):(()=>{const db=openDatabase(':memory:',true);migrate(db);return createSqliteRepository(db,()=>NOW);})();identity=await policyFixture(repo);service=new InquiryService(identity);dir=await mkdtemp(path.join(os.tmpdir(),'g09-boundary-'));}
    async function active(token=brand,contextId=A){const d=await service.createDraft(token,{contextId,taskId:null,idempotencyKey:randomUUID()});await service.command(token,d.conversationId,{command:'publish_first',expectedRevision:1,title:'Boundary',content:{clientMessageId:randomUUID(),body:'Initial',fileVersionIds:[]},idempotencyKey:randomUUID()});return d.conversationId;}
    afterEach(async()=>{repo?.close();if(dir)await rm(dir,{recursive:true,force:true});});
    it('A19 same brand other retailer and selected GSG scope never imply participation',async()=>{
        await setup();const id=await active(tokenFor('user-luna'),'ctx-jp-b-luna');
        for(const token of [brand,gsg,tokenFor('user-selected-admin'),tokenFor('user-wave')])await expect(service.detail(token,id)).rejects.toMatchObject({status:404});
        expect((await service.detail(admin,id)).phase).toBe('active');
        const same=await active();await expect(service.detail(tokenFor('user-co'),same)).rejects.toMatchObject({status:404});
        await expect(service.createDraft(brand,{contextId:'ctx-sg-a-luna',taskId:null,idempotencyKey:randomUUID()})).rejects.toMatchObject({status:404});
    });
    it('D02 actual inquiry download rechecks fresh membership after asynchronous byte IO',async()=>{
        await setup();const id=await active(),uploaded=await new InquiryFiles(identity,dir).upload(brand,id,[{clientItemId:randomUUID(),name:'proof.csv',type:'text/csv',bytes:Buffer.from('kind,value\nG09,1\n')}]);const f=uploaded.items[0];if(f.state!=='ready')throw Error('upload');
        const m=await service.command(brand,id,{command:'message',kind:'comment',questionId:null,content:{clientMessageId:randomUUID(),body:'',fileVersionIds:[f.file.id]},idempotencyKey:randomUUID()});let calls=0;
        const wrapped:RecordRepository={...repo,transaction:async op=>{const result=await repo.transaction(op);if(++calls===1)await repo.transaction(s=>{const user=s.get('user','user-gsg')!;s.update('user',user.id,user.revision,{...user.data,status:'suspended',authVersion:2});});return result;}};
        await expect(new FileService(new IdentityService(wrapped,()=>NOW),dir).download(gsg,f.file.id,{kind:'inquiry',conversationId:id,messageId:m.messageId!},'download')).rejects.toMatchObject({status:401});expect(calls).toBe(1);
    });
    it('D04 cursor delivery callback is never called after session revocation',async()=>{
        await setup();const id=await active(),d=await service.detail(brand,id);if(d.phase!=='active')throw Error('active');await service.command(gsg,id,{command:'message',kind:'comment',questionId:null,content:{clientMessageId:randomUUID(),body:'private after logout',fileVersionIds:[]},idempotencyKey:randomUUID()});
        await repo.transaction(s=>{const session=s.get('session','policy-session-user-team')!;s.update('session',session.id,session.revision,{...session.data,revokedAt:NOW});});let delivered=false;
        await expect(service.events(brand,id,new URLSearchParams({after:d.cursor}),()=>{delivered=true;})).rejects.toMatchObject({status:401});expect(delivered).toBe(false);
    });
});
