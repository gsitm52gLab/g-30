import { it,expect } from 'vitest';
import { mkdtempSync,readdirSync,copyFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase,migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { NoticeService } from '@/server/notices/service';
import { policyFixture,tokenFor } from '../fixtures/policy';
import { blankNotice } from '@/domain/notices/types';
it('G09 migration preserves populated accepted G08 notice and all old rows; repeat migration and seed write no rows',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'g09-migrate-')),db=openDatabase(':memory:',true),source=path.resolve('src/server/db/migrations');let repo:ReturnType<typeof createSqliteRepository>|undefined;
    try{
        for(const name of readdirSync(source).filter(n=>/^000[1-7]-/.test(n)&&n.endsWith('.sql')))copyFileSync(path.join(source,name),path.join(dir,name));
        expect(migrate(db,dir)).toEqual({applied:7,total:7});repo=createSqliteRepository(db);const identity=await policyFixture(repo),notice=new NoticeService(identity),admin=tokenFor('user-admin');
        const id=(await notice.create(admin,{contextId:'ctx-jp-a-luna',content:{...blankNotice(),title:'Existing published notice',body:'Keep original'},idempotencyKey:'g09-migration-notice'})).ids[0];
        await notice.command(admin,id,{command:'publish',expectedRevision:1,idempotencyKey:'g09-migration-publication'});
        const before=db.prepare('SELECT * FROM records ORDER BY kind,id').all();expect(migrate(db)).toEqual({applied:2,total:9});expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
        expect(migrate(db)).toEqual({applied:0,total:9});expect((await seed(repo)).inserted).toBe(0);expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);
    }finally{if(repo)repo.close();else db.close();rmSync(dir,{recursive:true,force:true});}
});
