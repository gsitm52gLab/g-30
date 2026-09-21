import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { IdentityService } from '@/server/auth/service';
import { AiReviewService } from '@/server/ai-review/service';
import { AiAssets } from '@/server/ai-input/assets';
import { CompletionService } from '@/server/completion/service';
import { NOW, tokenFor } from '../tests/fixtures/policy';
const accepted = '0804a4a1a750ab4dee149036659e212480230242';
const cwd = process.cwd(), candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const root = path.resolve(process.env.AI_REVIEW_HISTORY_ROOT ?? '.local/g16-history'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(path.join(root, 'copy-')), oldSource = path.join(directory, 'accepted-source'), originalDb = path.join(directory, 'original.sqlite'), copiedDb = path.join(directory, 'copy.sqlite'), originalFiles = path.join(directory, 'original-files'), copiedFiles = path.join(directory, 'copy-files');
const report = path.resolve(process.env.AI_REVIEW_HISTORY_REPORT ?? path.join(directory, 'report.json')); mkdirSync(path.dirname(report), { recursive: true }); mkdirSync(oldSource);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const tree = (dir: string): { path: string; sha256: string; bytes: number }[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? tree(path.join(dir, d.name)) : d.isFile() ? [{ path: path.join(dir, d.name), sha256: sha(readFileSync(path.join(dir, d.name))), bytes: readFileSync(path.join(dir, d.name)).length }] : []);
const checks: { id: string; status: 'PASS' | 'FAIL' }[] = []; let failure: string | undefined;
function check(id: string, value: unknown) { checks.push({ id, status: value ? 'PASS' : 'FAIL' }); assert(value, id); }
let originalHashes: { path: string; sha256: string; bytes: number }[] = [], copiedBeforeOpen: typeof originalHashes = [], fsCopyFinishedAt: string | null = null, firstCopySqliteOpenAt: string | null = null;
let repo: ReturnType<typeof createSqliteRepository> | undefined;
// This script runs only against a fresh, caller-owned synthetic directory. The accepted source is Git-exported, never checked out or modified in another worktree.
const helper = String.raw`
import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDatabase,migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { policyFixture,NOW,tokenFor } from '../tests/fixtures/policy';
import { ProductService } from '@/server/products/service';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { AiInputService } from '@/server/ai-input/service';
import { AiAssets } from '@/server/ai-input/assets';
import { CompletionService } from '@/server/completion/service';
import { blankContent,blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
const [database,directory,output]=process.argv.slice(2),ctx='ctx-jp-a-luna',brand=tokenFor('user-luna'),admin=tokenFor('user-admin');
const db=openDatabase(database,true);const migration=migrate(db);if(migration.total!==12)throw Error('accepted source must have exactly12 migrations');const repo=createSqliteRepository(db,()=>NOW),identity=await policyFixture(repo);
try{
 const products=new ProductService(identity),p=await products.detail(brand,'product-serum',ctx);await products.command(brand,p.productId,{command:'save_common',contextId:ctx,expectedCommonRevision:p.commonRevision,common:{...p.common,name:'ACTUAL_ACCEPTED_USER_EDIT'},idempotencyKey:randomUUID()});
 const request={...blankContent(),title:'Accepted historical actual submission',description:'합성 과거 제출',deadline:{...blankContent().deadline,responsibleUserId:'user-gsg'},requirements:[{...blankRequirement('claim','long_text'),label:'일본어 문안'}]},tasks=new TaskService(identity),taskId=(await tasks.create(admin,{targets:[{contextId:ctx,ownerId:'user-gsg',assigneeId:'user-luna',coAssigneeIds:[],productIds:[]}],content:request,category:'spot',idempotencyKey:randomUUID()})).ids[0];await tasks.command(admin,taskId,{command:'publish',expectedRevision:1,idempotencyKey:randomUUID()});
 const submissions=new SubmissionService(identity);let w=await submissions.workspace(brand,taskId);const claim='合成契約検証用。絶対安全。';await submissions.draft(brand,taskId,{command:'save',baseRequestId:w.request.id,expectedDraftRevision:0,content:{...blankDraft(),answers:[{requestId:w.request.id,requirementKey:'claim',productId:null,type:'long_text',input:{text:claim}}]},idempotencyKey:randomUUID()});w=await submissions.workspace(brand,taskId);const submissionId=(await submissions.submit(brand,taskId,{baseRequestId:w.request.id,expectedDraftRevision:w.draft!.revision,expectedTaskRevision:w.taskRevision,mode:'full',idempotencyKey:randomUUID()})).ids[0];
 const inputs=new AiInputService(identity,directory),input=await inputs.create(brand,{contextId:ctx,visibility:'context',content:{title:'Accepted G15 original',scope:{classification:'general_cosmetic',language:'ja',media:'pop',use:'合成'},kind:'text',text:claim,sources:[],selectedPages:[],submission:{taskId,requestId:w.request.id,submissionId,productUseIds:[]},products:[]},idempotencyKey:randomUUID()}),extraction=await inputs.extract(brand,input.id,{versionId:input.version.id,expectedRunId:null,idempotencyKey:randomUUID()});
 const asset=await new AiAssets(identity,directory).upload(brand,ctx,'context',randomUUID(),{name:'accepted-original.pdf',type:'application/pdf',bytes:readFileSync(path.resolve('tests/fixtures/ai-input/native-12.pdf'))});
 const completion=new CompletionService(identity),preview=await completion.workspace(admin,taskId),completionId=(await completion.command(admin,{command:'complete',taskId,expectedTaskRevision:preview.taskRevision,expectedBasisHash:preview.preview!.basisHash,memo:'',idempotencyKey:randomUUID()})).ids[0];
 const snapshot=await completion.snapshot(admin,completionId);if(snapshot.basis.ai.state!=='not_connected')throw Error('accepted old AI must remain not_connected');
 writeFileSync(output,JSON.stringify({migration,taskId,submissionId,inputId:input.id,versionId:input.version.id,extractionRunId:extraction.runId,snapshotHash:extraction.detail.runs[0].snapshot!.snapshotHash,asset,completionId,rows:db.prepare('SELECT * FROM records ORDER BY kind,id').all(),migrations:db.prepare('SELECT * FROM schema_migrations ORDER BY name').all()},null,2));
}finally{repo.close();}
`;
try {
  const archive = execFileSync('git', ['archive', accepted, 'src', 'tests/fixtures', 'package.json', 'tsconfig.json'], { maxBuffer: 100 * 1024 * 1024 });
  const archivePath = `${report}.accepted-source.tar`; writeFileSync(archivePath, archive); execFileSync('tar', ['-xf', archivePath, '-C', oldSource]);
  symlinkSync(path.join(cwd, 'node_modules'), path.join(oldSource, 'node_modules'), 'dir'); mkdirSync(path.join(oldSource, 'scripts')); const helperPath = path.join(oldSource, 'scripts', 'g16-history-producer.ts'); writeFileSync(helperPath, helper);
  writeFileSync(`${report}.accepted-helper.ts`, helper);
  const fixturePath = `${report}.accepted-produced.json`, produced = spawnSync(process.execPath, [path.join(cwd, 'node_modules/tsx/dist/cli.mjs'), helperPath, originalDb, originalFiles, fixturePath], { cwd: oldSource, encoding: 'utf8' });
  writeFileSync(`${report}.accepted-producer-command.json`, JSON.stringify({ command: [process.execPath, path.join(cwd, 'node_modules/tsx/dist/cli.mjs'), helperPath, originalDb, originalFiles, fixturePath], cwd: oldSource, accepted, exit_code: produced.status, archive_sha256: sha(archive), helper_sha256: sha(helper), source_files: tree(path.join(oldSource, 'src')) }, null, 2));
  writeFileSync(`${report}.accepted-producer.log`, produced.stdout + produced.stderr);
  check('P01 accepted exact12 source creates real G05/G06/G15/G11 historical state', produced.status === 0);
  const prior = JSON.parse(readFileSync(fixturePath, 'utf8'));
  // Record and copy SQLite files using the filesystem BEFORE any connection to the original/copy in this current product process.
  const dbFiles = ['', '-wal', '-shm'].map(suffix => originalDb + suffix).filter(existsSync);
  originalHashes = [...dbFiles.map(p => ({ path: p, sha256: sha(readFileSync(p)), bytes: readFileSync(p).length })), ...tree(originalFiles)];
  for (const source of dbFiles) cpSync(source, copiedDb + source.slice(originalDb.length)); cpSync(originalFiles, copiedFiles, { recursive: true });
  copiedBeforeOpen = [...dbFiles.map(p => { const dest = copiedDb + p.slice(originalDb.length); return { path: dest, sha256: sha(readFileSync(dest)), bytes: readFileSync(dest).length }; }), ...tree(copiedFiles)];
  fsCopyFinishedAt = new Date().toISOString();
  check('P02 filesystem byte copy precedes SQLite opening', originalHashes.every((x, i) => x.sha256 === copiedBeforeOpen[i].sha256));
  firstCopySqliteOpenAt = new Date().toISOString(); const db = openDatabase(copiedDb); repo = createSqliteRepository(db, () => NOW);
  check('P03 exact copied raw rows and previous migration ledger', JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(prior.rows) && JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY name').all()) === JSON.stringify(prior.migrations));
  check('P04 only0013 applied with old rows and SQL hashes unchanged', JSON.stringify(migrate(db)) === JSON.stringify({ applied: 1, total: 13 }) && JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(prior.rows) && JSON.stringify(db.prepare("SELECT * FROM schema_migrations WHERE name<'0013' ORDER BY name").all()) === JSON.stringify(prior.migrations));
  const seeded = await seed(repo); const identity = new IdentityService(repo, () => NOW), reviewService = new AiReviewService(identity, copiedFiles), completion = new CompletionService(identity);
  check('P05 bootstrap only adds two corpus rows; repeat seed/migration preserves all existing edits', seeded.corpus.inserted === 2 && JSON.stringify(db.prepare("SELECT * FROM records WHERE kind NOT IN ('aiCorpusRelease','aiCorpusHead') ORDER BY kind,id").all()) === JSON.stringify(prior.rows));
  const beforeRepeat = JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()); await seed(repo);
  check('P06 repeat seed and migration exact all rows', JSON.stringify(migrate(db)) === JSON.stringify({ applied: 0, total: 13 }) && JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === beforeRepeat);
  const old = await completion.snapshot(tokenFor('user-admin'), prior.completionId), publicOld = await completion.snapshot(tokenFor('user-luna'), prior.completionId);
  check('P07 old GSG not_connected snapshot preserved with constant brand restricted projection', old.basis.ai.state === 'not_connected' && JSON.stringify(publicOld.basis.ai) === JSON.stringify({ connected: true, state: 'unavailable', value: null, reason: 'source_unavailable' }));
  const workspace = await reviewService.workspace(tokenFor('user-gsg'), prior.inputId, prior.versionId), result = await reviewService.start(tokenFor('user-gsg'), prior.inputId, { inputVersionId: prior.versionId, extractionRunId: prior.extractionRunId, expectedRunId: null, corpusReleaseId: workspace.corpus.id, corpusManifestHash: workspace.corpus.manifestHash, engine: 'synthetic_demo', idempotencyKey: randomUUID() });
  check('P08 actual accepted G15 snapshot feeds new analysis preserving exact old immutable rows', result.detail.snapshotHash === prior.snapshotHash && result.detail.state === 'finished' && prior.rows.every((r: { kind: string; id: string }) => JSON.stringify(db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(r.kind, r.id)) === JSON.stringify(r)));
  const bytes = (await new AiAssets(identity, copiedFiles).download(tokenFor('user-luna'), prior.asset.id)).bytes;
  check('P09 authorized copied original bytes unchanged', sha(Buffer.from(bytes)) === prior.asset.sha256);
  repo.close(); repo = undefined;
  check('P10 original DB sidecars and files never changed by migration/read/write of copy', originalHashes.every(x => existsSync(x.path) && sha(readFileSync(x.path)) === x.sha256));
} catch (error) { failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  repo?.close();
  writeFileSync(report, JSON.stringify({ candidate_commit: candidate, cwd, accepted_source: accepted, checks, counts: { pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, unit: 'assertion' }, notRun: Array.from({ length: 10 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`).filter(id => !checks.some(c => c.id.startsWith(id))), failure, directory, originalDb, copiedDb, originalFiles, copiedFiles, originalHashes, copiedBeforeOpen, fsCopyFinishedAt, firstCopySqliteOpenAt, providerCalls: 0, sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }) }, null, 2) + '\n');
  console.log(JSON.stringify({ report, pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, failure }));
}
