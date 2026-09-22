import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { directUpload, boundedDownload, type DirectUploadCallbacks, type UploadResumeState } from '@/features/files/transfer';
import { downloadMetadata } from '@/features/files/download';
import { createPrivateStorageFactory } from '@/server/files/storage-runtime';
import type { GrantStatus, UploadCapability } from '@/domain/storage/types';
const CHUNK=4*1024*1024, TUS=6*1024*1024;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function metadata(bytes:Uint8Array){return{id:'file-a',name:'synthetic.csv',mime:'text/csv',bytes:bytes.length,sha256:hash(bytes),etag:`"${hash(bytes)}"`,chunkBytes:CHUNK,downloadUrl:'/api/files/file-a?taskId=task-a'};}
const granted:GrantStatus={id:'grant-a',revision:1,state:'issued',expiresAt:Date.now()+600000,result:null,failure:null};
const ready:GrantStatus={...granted,revision:3,state:'ready',result:{kind:'fileVersion',id:'file-a'}};
function cap(bytes:number):UploadCapability{return{key:'gs-hale/staging/11111111-1111-4111-8111-111111111111',bucket:'gs-hale-private',signedUrl:'https://sample.supabase.co/storage/v1/object/upload/sign/gs-hale-private/gs-hale/staging/11111111-1111-4111-8111-111111111111?token=scoped.jwt.token',token:'scoped.jwt.token',method:'PUT',resumableEndpoint:'https://sample.storage.supabase.co/storage/v1/upload/resumable/sign',tusChunkBytes:TUS,appExpiresAt:Date.now()+600000,storageExpiresAt:Date.now()+7200000,safeCleanupAfter:Date.now()+86400000,expectedBytes:bytes,bucketMaxBytes:25*1024*1024};}
function callbacks(bytes:number):DirectUploadCallbacks<string>{return{issue:vi.fn(async()=>({status:granted,capability:cap(bytes)})),status:vi.fn(async()=>granted),finalize:vi.fn(async()=>ready),resolve:vi.fn(async()=> 'file-a')};}
const fetchAs=(fn:(url:string,init:RequestInit)=>Promise<Response>)=>vi.fn((url:URL|RequestInfo,init?:RequestInit)=>fn(String(url),init??{})) as unknown as typeof fetch;
describe('shared bounded file transport',()=>{
 it('reads >4MiB only in exact authenticated ranges and verifies whole hash',async()=>{
  const bytes=new Uint8Array(CHUNK+123).fill(65),m=metadata(bytes),seen:string[]=[];
  const fetcher=fetchAs(async(url,init)=>{expect(init.credentials).toBe('same-origin');if(url.includes('metadata=1'))return Response.json(m);const headers=new Headers(init.headers),range=headers.get('range')!;seen.push(range);expect(headers.get('if-match')).toBe(m.etag);const [start,end]=range.slice(6).split('-').map(Number);return new Response(bytes.slice(start,end+1),{status:206,headers:{etag:m.etag,'content-range':`bytes ${start}-${end}/${bytes.length}`}});});
  const result=await boundedDownload('/api/files/file-a?metadata=1',{fetcher});expect(result.blob.size).toBe(bytes.length);expect(hash(new Uint8Array(await result.blob.arrayBuffer()))).toBe(m.sha256);expect(seen).toEqual([`bytes=0-${CHUNK-1}`,`bytes=${CHUNK}-${bytes.length-1}`]);
 });
 it.each(['etag','range','short','hash','oversize'] as const)('rejects %s disagreement without releasing a Blob',async(fault)=>{
  const bytes=new Uint8Array([65,66,67]),m=metadata(bytes);
  const fetcher=fetchAs(async(url)=>{if(url.includes('metadata=1'))return Response.json(m);return new Response(fault==='short'?bytes.slice(0,2):fault==='hash'?new Uint8Array([1,2,3]):fault==='oversize'?new Uint8Array(4):bytes,{status:206,headers:{etag:fault==='etag'?'"changed"':m.etag,'content-range':fault==='range'?'bytes 1-3/4':'bytes 0-2/3'}});});
  await expect(boundedDownload('/api/files/file-a?metadata=1',{fetcher})).rejects.toMatchObject({code:'INTEGRITY'});
 });
 it('stops on current ACL revocation before fetching another chunk',async()=>{
  const bytes=new Uint8Array(CHUNK*2+1),m=metadata(bytes);let requests=0;
  const fetcher=fetchAs(async(url)=>{if(url.includes('metadata=1'))return Response.json(m);requests++;if(requests===2)return new Response(null,{status:404});return new Response(bytes.slice(0,CHUNK),{status:206,headers:{etag:m.etag,'content-range':`bytes 0-${CHUNK-1}/${bytes.length}`}});});
  await expect(boundedDownload('/api/files/file-a?metadata=1',{fetcher})).rejects.toMatchObject({code:'ACCESS_CHANGED'});expect(requests).toBe(2);
 });
 it('rejects external download URLs and oversized metadata before byte requests',async()=>{
  const m=metadata(new Uint8Array(3));expect(()=>downloadMetadata({...m,downloadUrl:'https://example.test/private'})).toThrow();expect(()=>downloadMetadata({...m,bytes:12},10)).toThrow();expect(downloadMetadata({...m,bytes:70*1024*1024},Number.MAX_SAFE_INTEGER).bytes).toBe(70*1024*1024);
 });
 it('never sends a cancelled download request',async()=>{
  const controller=new AbortController();controller.abort();const fetcher=vi.fn(async()=>{throw Error('aborted');}) as typeof fetch;
  await expect(boundedDownload('/api/files/file-a?metadata=1',{signal:controller.signal,fetcher})).rejects.toMatchObject({code:'ABORTED'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('uploads signed bytes directly without server credentials then resolves only ready',async()=>{
  const file=new File(['synthetic csv'],'synthetic.csv',{type:'text/csv'}),cb=callbacks(file.size),state:UploadResumeState={};
  const fetcher=fetchAs(async(url,init)=>{expect(url).toBe(cap(file.size).signedUrl);expect(init.credentials).toBe('omit');expect(new Headers(init.headers).has('authorization')).toBe(false);expect(init.body).toBe(file);return new Response(null,{status:200});});
  expect(await directUpload(file,{clientItemId:'file-item-a',callbacks:cb,state,fetcher})).toBe('file-a');expect(state).toMatchObject({grantId:'grant-a',uploaded:true});expect(cb.issue).toHaveBeenCalledWith(expect.objectContaining({expectedBytes:file.size,expectedSha256:hash(new Uint8Array(await file.arrayBuffer()))}),undefined);
 });
 it('treats provider HTTP400 as ambiguous and accepts only a server-verified ready record',async()=>{
  const file=new File(['a'],'a.csv'),cb=callbacks(1),fetcher=fetchAs(async()=>new Response(null,{status:400}));
  expect(await directUpload(file,{clientItemId:'file-item-a',callbacks:cb,fetcher})).toBe('file-a');expect(cb.finalize).toHaveBeenCalledTimes(1);
  cb.finalize=vi.fn(async()=>granted);
  await expect(directUpload(file,{clientItemId:'file-item-b',callbacks:cb,fetcher})).rejects.toMatchObject({code:'NOT_READY'});
 });
 it('ready retry does not upload bytes or create a second grant',async()=>{
  const file=new File(['a'],'a.csv'),cb=callbacks(1);cb.status=vi.fn(async()=>ready);const fetcher=vi.fn() as typeof fetch;
  expect(await directUpload(file,{clientItemId:'file-item-a',callbacks:cb,state:{grantId:'grant-a'},fetcher})).toBe('file-a');expect(fetcher).not.toHaveBeenCalled();expect(cb.issue).not.toHaveBeenCalled();
 });
 it('resumes the same TUS resource after an interrupted chunk using authoritative HEAD',async()=>{
  const file=new File([new Uint8Array(TUS+5)],'a.csv',{type:'text/csv'}),cb=callbacks(file.size),state:UploadResumeState={};let creates=0,offset=0,failed=false;
  const fetcher=fetchAs(async(url,init)=>{
   if(init.method==='POST'){creates++;return new Response(null,{status:201,headers:{location:'https://sample.storage.supabase.co/storage/v1/upload/resumable/synthetic'}});}
   if(init.method==='HEAD')return new Response(null,{status:200,headers:{'upload-offset':String(offset)}});
   expect(url.endsWith('/synthetic')).toBe(true);expect(new Headers(init.headers).get('upload-offset')).toBe(String(offset));
   if(offset===TUS&&!failed){failed=true;throw Error('synthetic network loss');}offset+=(init.body as Blob).size;return new Response(null,{status:204,headers:{'upload-offset':String(offset)}});
  });
  await expect(directUpload(file,{clientItemId:'file-item-large',callbacks:cb,state,fetcher})).rejects.toMatchObject({code:'TRANSFER_FAILED'});expect(cb.finalize).not.toHaveBeenCalled();expect(offset).toBe(TUS);
  expect(await directUpload(file,{clientItemId:'file-item-large',callbacks:cb,state,fetcher})).toBe('file-a');expect(creates).toBe(1);expect(offset).toBe(file.size);
 });
 it('reconciles ambiguous finalize with current ready status without another upload',async()=>{
  const file=new File(['a'],'a.csv'),cb=callbacks(1);cb.finalize=vi.fn(async()=>{throw Error('network');});cb.status=vi.fn(async()=>ready);
  expect(await directUpload(file,{clientItemId:'file-item-a',callbacks:cb,fetcher:fetchAs(async()=>new Response(null,{status:200}))})).toBe('file-a');expect(cb.finalize).toHaveBeenCalledTimes(1);expect(cb.status).toHaveBeenCalledTimes(1);
 });
 it('rejects an external capability before sending file bytes',async()=>{
  const file=new File(['a'],'a.csv'),cb=callbacks(1);cb.issue=vi.fn(async()=>({status:granted,capability:{...cap(1),signedUrl:'https://example.test/collect'}}));const fetcher=vi.fn() as typeof fetch;
  await expect(directUpload(file,{clientItemId:'file-item-a',callbacks:cb,fetcher})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('sanitizes a rejected ready DTO callback rather than exposing an underlying message',async()=>{
  const file=new File(['a'],'a.csv'),cb=callbacks(1);cb.status=vi.fn(async()=>ready);cb.resolve=vi.fn(async()=>{throw Error('synthetic_private_capability');});
  await expect(directUpload(file,{clientItemId:'file-item-a',callbacks:cb,state:{grantId:'grant-a'}})).rejects.toMatchObject({name:'FileTransferError',code:'TRANSFER_FAILED'});
 });
 it('constructs Storage lazily and never falls back after invalid config',()=>{
  const environment=vi.fn(()=>({SUPABASE_URL:'https://sample.supabase.co/rest/v1',SUPABASE_SECRET_KEY:'sb_secret_synthetic_key_123456789'}));const factory=createPrivateStorageFactory(environment);expect(environment).not.toHaveBeenCalled();expect(factory().allocateStagingKey()).toMatch(/^gs-hale\/staging\//);expect(factory()).toBe(factory());expect(environment).toHaveBeenCalledTimes(1);
  const bad=createPrivateStorageFactory(()=>({}));expect(()=>bad()).toThrow();expect(()=>bad()).toThrow();
 });
});
