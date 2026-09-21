import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile,mkdir,readdir,readFile,stat,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase,migrate } from '@/server/db/database';
const [sourceDb,sourceFiles,destination]=process.argv.slice(2);assert(sourceDb&&sourceFiles&&destination,'original DB/files/private destination required');
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
await mkdir(destination,{recursive:true});const copies:{source:string;copy:string;sha256:string;bytes:number}[]=[];const checks:{id:string;pass:boolean}[]=[],skipped:string[]=[];let failure:string|undefined;
function check(id:string,condition:unknown){checks.push({id,pass:!!condition});assert(condition,id);}
async function copy(source:string,target:string){await mkdir(path.dirname(target),{recursive:true});const bytes=await readFile(source);await copyFile(source,target);check('filesystem copy SHA matches',hash(await readFile(target))===hash(bytes));copies.push({source,copy:target,sha256:hash(bytes),bytes:bytes.length});}
async function tree(source:string,target:string){await mkdir(target,{recursive:true});for(const e of await readdir(source,{withFileTypes:true})){const a=path.join(source,e.name),b=path.join(target,e.name);if(e.isDirectory())await tree(a,b);else if(e.isFile())await copy(a,b);}}
const dbfile=path.join(destination,'upgrade.db');let firstOpenAt:string|null=null,copyCompletedAt:string|null=null,db:ReturnType<typeof openDatabase>|null=null;
try{
 for(const suffix of ['','-wal','-shm']){try{await stat(sourceDb+suffix);}catch{continue;}await copy(sourceDb+suffix,path.join(destination,'pristine','original.db'+suffix));await copy(sourceDb+suffix,dbfile+suffix);}
 await tree(sourceFiles,path.join(destination,'pristine','files'));await tree(sourceFiles,path.join(destination,'files'));copyCompletedAt=new Date().toISOString();
 // No SQLite driver was invoked against any original path. Filesystem copies above are complete before first open.
 firstOpenAt=new Date().toISOString();db=openDatabase(dbfile);const oldRows=db.prepare('SELECT * FROM records ORDER BY kind,id').all(),oldMigrations=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {name:string;sha256:string}[];
 check('original populated records exist',oldRows.length>100);check('prior actual membership exactly 0001..0008',JSON.stringify(oldMigrations.map(m=>Number(m.name.slice(0,4))))===JSON.stringify([1,2,3,4,5,6,7,8]));const result=migrate(db);check('only0012 added total9',result.applied===1&&result.total===9);check('all prior record JSON/metadata unchanged',JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all())===JSON.stringify(oldRows));
 const after=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {name:string;sha256:string}[];check('prior migration hashes preserved',JSON.stringify(after.filter(m=>oldMigrations.some(p=>p.name===m.name)))===JSON.stringify(oldMigrations));
 for(const kind of ['submission','productVersion','productUseSnapshot','noticeVersion','inquiryMessage','evidenceAssessment']){const row=db.prepare('SELECT id FROM records WHERE kind=? LIMIT 1').get(kind) as {id:string}|undefined;if(!row){skipped.push(`no historical ${kind} row in supplied G09 fixture; all existing rows still hash-compared`);continue;}let denied=false;try{db.prepare('UPDATE records SET data=data WHERE kind=? AND id=?').run(kind,row.id);}catch{denied=true;}check(`old ${kind} SQL immutability retained`,denied);}
 const repeated=migrate(db);check('repeat applies0',repeated.applied===0&&repeated.total===9);check('all rows still identical after guards/repeat',JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all())===JSON.stringify(oldRows));db.close();db=null;
 for(const c of copies.filter(c=>c.source.startsWith(sourceFiles))){check('source upload unchanged',hash(await readFile(c.source))===c.sha256);check('copied upload unchanged',hash(await readFile(c.copy))===c.sha256);}
 await writeFile(path.join(destination,'rows-before.json'),JSON.stringify(oldRows,null,2)+'\n',{mode:0o600});
 await writeFile(path.join(destination,'migration-facts.json'),JSON.stringify({oldMigrations,after,result,repeat:repeated,oldRows:oldRows.length,oldRowsSha256:hash(JSON.stringify(oldRows))},null,2)+'\n');
}catch(error){failure=error instanceof Error?error.stack:String(error);process.exitCode=1;}finally{db?.close();await writeFile(path.join(destination,'report.json'),JSON.stringify({candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cwd:process.cwd(),sourceDb,sourceFiles,sourceOpened:false,copyCompletedAt,firstOpenAt,copies,checks,skipped,counts:{pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass).length,skip:skipped.length,unit:'assertion'},failure},null,2)+'\n');console.log(JSON.stringify({report:path.join(destination,'report.json'),pass:checks.filter(c=>c.pass).length,failure}));}
