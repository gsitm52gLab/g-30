import { afterEach, expect, it, vi } from 'vitest';
import type { IdentityService } from '@/server/auth/service';
import type { RecordRepository } from '@/domain/records';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { migrate, openDatabase } from '@/server/db/database';
import { policyFixture, tokenFor, NOW, CONTEXT } from '../fixtures/policy';
const runtime=vi.hoisted(()=>({identity:null as IdentityService|null,token:''}));
vi.mock('@/server/auth/runtime',()=>({identity:async()=>runtime.identity!,currentToken:async()=>runtime.token}));
import { readWorkspace } from '@/server/workspace';
let repo:RecordRepository;
afterEach(async()=>{await repo?.close();runtime.identity=null;});
for(const mode of ['mock','sqlite']as const)it(`${mode} shared workspace read memo preserves DTO and fresh membership revocation`,async()=>{
 if(mode==='mock')repo=createMockRepository(()=>NOW);else{const db=openDatabase(':memory:',true);migrate(db);repo=createSqliteRepository(db,()=>NOW);}
 runtime.identity=await policyFixture(repo);runtime.token=tokenFor('user-team');
 const before=await readWorkspace(CONTEXT),audits=await repo.list('audit');expect(before.tasks.length).toBeGreaterThan(0);expect(before.products.length).toBeGreaterThan(0);expect(JSON.stringify(before)).not.toMatch(/internalSupply|privateNested|tokenHash/);
 const member=(await repo.list('membership',CONTEXT)).find(m=>m.data.userId==='user-team')!;
 await repo.transaction(s=>s.update('membership',member.id,member.revision,{...member.data,status:'suspended'}));
 await expect(readWorkspace(CONTEXT)).rejects.toMatchObject({status:404});const empty=await readWorkspace();expect(empty.contexts).toEqual([]);expect(empty.tasks).toEqual([]);expect(empty.products).toEqual([]);
 const changed=(await repo.get('membership',member.id))!;await repo.transaction(s=>s.update('membership',member.id,changed.revision,member.data));expect(await readWorkspace(CONTEXT)).toEqual(before);expect(await repo.list('audit')).toEqual(audits);
});
