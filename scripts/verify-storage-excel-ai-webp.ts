/** Narrow actual WebP preservation proof. Own UUID objects only; no external AI provider. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parsePostgresConfig } from '@/server/postgres/config';
import { createPostgresRepository } from '@/server/postgres/repository';
import { migratePostgres } from '@/server/postgres/migrate';
import { IdentityService } from '@/server/auth/service';
import { SupabasePrivateStorage } from '@/server/storage/supabase';
import { AiAssetStorage } from '@/server/ai-input/storage';
import { AiInputService } from '@/server/ai-input/service';
import { VersionSourceStorage } from '@/server/ai-input/storage-source';
import { createFixture, fixtureIds } from './verify-storage-app-shared';
import { digest } from '@/domain/storage/validate';
const [envFile,outputFile]=process.argv.slice(2);
if(!envFile?.startsWith('/')||!outputFile?.startsWith('/'))throw Error('Absolute paths required');
const original=readFileSync(envFile),env=parseEnv(original.toString()),runId=randomUUID(),f=fixtureIds(runId),namespace=`s4_webp_${runId.replaceAll('-','')}`,clock=()=>new Date().toISOString();
const schema=process.env.S4_SCHEMA||'gs_hale_storage_excel_ai_20260922';if(!/^gs_hale_storage_excel_ai(?:_ind)?_[a-z0-9_]{1,25}$/.test(schema))throw Error('Dedicated schema required');
const config=parsePostgresConfig({...env,SUPABASE_DB_SCHEMA:schema},'migration'),repo=createPostgresRepository(config),other=createPostgresRepository(config),identity=new IdentityService(repo,clock),second=new IdentityService(other,clock);
for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_STORAGE_BUCKET'])if(env[key])process.env[key]=env[key];process.env.SUPABASE_STORAGE_NAMESPACE=namespace;
const storageConfig={projectUrl:env.SUPABASE_URL||'',secretKey:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'',bucket:env.SUPABASE_STORAGE_BUCKET||'gs-hale-private',namespace,timeoutMs:120000},remote=new SupabasePrivateStorage(storageConfig),owned=new Set<string>();
const transport=()=>({allocateStagingKey:()=>{const key=remote.allocateStagingKey();owned.add(key);return key;},allocateFinalKey:()=>{const key=remote.allocateFinalKey();owned.add(key);return key;},issueUploadGrant:remote.issueUploadGrant.bind(remote),inspect:remote.inspect.bind(remote),readSnapshot:remote.readSnapshot.bind(remote),promoteVerified:remote.promoteVerified.bind(remote),readRange:remote.readRange.bind(remote),cleanupExpiredStaging:remote.cleanupExpiredStaging.bind(remote)});
const report={candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cwd:process.cwd(),pid:process.pid,schema,runId,startedAt:clock(),checks:[] as {name:string;status:string;details?:unknown}[],providerCalls:0,actualStorage:'EXECUTED',envUnchanged:false};
writeFileSync(outputFile,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
const save=()=>writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
try{
 assert.equal((await migratePostgres(config)).total,19);await createFixture(repo,runId,clock);
 const image=await loadImage(readFileSync('tests/fixtures/ai-input/japanese.png')),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);const bytes=await canvas.encode('webp',100);
 const a=new AiAssetStorage(identity,transport),metadata={contextId:f.contextId,clientItemId:randomUUID(),owner:{purpose:'ai_asset' as const,inputKind:'image' as const},visibility:'public' as const,originalName:'japanese.webp',declaredMime:'image/webp',expectedBytes:bytes.length,expectedSha256:digest(bytes)},grant=await a.issue(f.token,metadata);assert(grant.capability);
 const uploaded=await fetch(grant.capability.signedUrl,{method:'PUT',body:bytes as BodyInit,headers:{'content-type':'image/webp'},signal:AbortSignal.timeout(120000)});const status=uploaded.status;await uploaded.body?.cancel();assert.equal(status,200);
 const ready=await new AiAssetStorage(second,transport).finalize(f.token,grant.status.id);assert(ready.result);assert.equal(digest((await a.snapshot(f.token,ready.result.id)).bytes),digest(bytes));report.checks.push({name:'W01 valid WebP A upload B finalize exact SHA',status:'PASS',details:{bytes:bytes.length,sha256:digest(bytes)}});save();
 const service=new AiInputService(identity),input=await service.create(f.token,{contextId:f.contextId,visibility:'context',idempotencyKey:randomUUID(),content:{title:'合成WebP',scope:{classification:'general_cosmetic',language:'ja',media:'pop',use:'店頭'},kind:'images',text:null,sources:[{kind:'upload',assetId:ready.result.id}],selectedPages:[],submission:null,products:[]}});
 const revised=await service.revise(f.token,input.id,{expectedRevision:input.revision,idempotencyKey:randomUUID(),content:{...input.version.content,title:'新しい本文',kind:'text',text:'現在の本文',sources:[],selectedPages:[]}});assert.notEqual(revised.version.id,input.version.id);
 assert.equal(digest((await new VersionSourceStorage(second,transport).snapshot(f.token,input.id,input.version.id,0)).bytes),digest(bytes));const extracted=await new AiInputService(second).extract(f.token,input.id,{versionId:input.version.id,expectedRunId:null,idempotencyKey:randomUUID()}),snapshot=extracted.detail.runs[0].snapshot;assert(snapshot);assert(snapshot.text.includes('すこやか'));assert.equal(snapshot.units.length,1);assert.equal(snapshot.providerCalled,false);report.checks.push({name:'W02 same stored WebP reaches actual Japanese OCR worker',status:'PASS',details:{state:extracted.detail.runs[0].state,units:1,textSha256:digest(snapshot.text),characters:snapshot.characterCount}});save();
 const previous=(await repo.list('importExport')).find(r=>r.contextId!==f.contextId);assert(previous);await assert.rejects(repo.transaction(s=>s.create('importExport',{id:randomUUID(),contextId:f.contextId,data:{...previous.data,actorId:f.userId}})),{code:'INVALID_RECORD'});report.checks.push({name:'W03 older selected version remains exact after current revision; cross-context part reuse denied',status:'PASS'});save();
 await other.transaction(async s=>{const m=(await s.get('membership',f.memberId))!;await s.update('membership',m.id,m.revision,{...m.data,status:'suspended'});});for(const operation of [()=>a.status(f.token,grant.status.id),()=>a.finalize(f.token,grant.status.id),()=>a.issue(f.token,metadata)])await assert.rejects(operation(),{status:404});report.checks.push({name:'W04 fresh revoked grant status/finalize/issue replay denied',status:'PASS',details:{denied:3}});save();
}catch(e){report.checks.push({name:'execution',status:'FAIL',details:{code:e&&typeof e==='object'&&'code'in e&&typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'ASSERTION_OR_UNCLASSIFIED'}});save();process.exitCode=1;}
finally{
 try{assert([...owned].every(k=>k.startsWith(namespace+'/')));if(owned.size){const response=await fetch(`${new URL(storageConfig.projectUrl).origin}/storage/v1/object/${storageConfig.bucket}`,{method:'DELETE',headers:{apikey:storageConfig.secretKey,authorization:`Bearer ${storageConfig.secretKey}`,'content-type':'application/json'},body:JSON.stringify({prefixes:[...owned]}),signal:AbortSignal.timeout(60000)});const status=response.status;await response.body?.cancel();assert.equal(status,200);}report.checks.push({name:'C01 own UUID objects cleanup only',status:'PASS',details:{count:owned.size,schemaRetained:true}});}catch{report.checks.push({name:'cleanup',status:'FAIL'});process.exitCode=1;}
 report.envUnchanged=digest(readFileSync(envFile))===digest(original);save();await repo.close();await other.close();console.log(JSON.stringify({checks:report.checks,pid:process.pid}));
}
