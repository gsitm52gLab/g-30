import { it,expect } from 'vitest';
import { mkdtempSync,readdirSync,copyFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase,migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { policyFixture,tokenFor } from '../fixtures/policy';
import { FileService } from '@/server/files/service';
it('G10 populated accepted six migrations preserve all old business rows and actual file bytes; repeat migration/seed no writes',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'g10-migration-')),sql=path.join(dir,'sql');const fs=await import('node:fs');fs.mkdirSync(sql);const db=openDatabase(':memory:',true),source=path.resolve('src/server/db/migrations');let repo:ReturnType<typeof createSqliteRepository>|undefined;
 try{for(const name of readdirSync(source).filter(n=>n.endsWith('.sql')&&(Number(n.slice(0,4))<=5||Number(n.slice(0,4))===7)))copyFileSync(path.join(source,name),path.join(sql,name));expect(migrate(db,sql)).toEqual({applied:6,total:6});repo=createSqliteRepository(db);const identity=await policyFixture(repo),bytes=Buffer.from('kind,value\nG10,oldfile\n'),file=(await new FileService(identity,dir).upload(tokenFor('user-admin'),'task-onboarding',[{name:'existing.csv',type:'text/csv',bytes}],'internal')).files[0];await repo.transaction(s=>{const t=s.get('task','task-onboarding')!;s.update('task',t.id,t.revision,{...t.data,title:'Edited accepted row'});});const before=db.prepare('SELECT * FROM records ORDER BY kind,id').all();expect(migrate(db)).toEqual({applied:4,total:10});expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);expect(readFileSync(path.join(dir,file.id))).toEqual(bytes);expect(migrate(db)).toEqual({applied:0,total:10});expect((await seed(repo)).inserted).toBe(0);expect(db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before);}finally{if(repo)repo.close();else db.close();rmSync(dir,{recursive:true,force:true});}
});
