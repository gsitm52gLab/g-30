import { describe, it, expect } from 'vitest';
import { authorizedPrivateJsonResponse, privateJsonResponse } from '@/server/imports/storage-http';
import { digest } from '@/domain/storage/validate';
import { STORAGE_LIMITS } from '@/domain/storage/types';
describe('private import DTO bounded JSON transport',()=>{
 it('keeps full long cell text in exact immutable chunks without a large response',async()=>{
  const value={sourceId:'source',rows:[{text:'あ'.repeat(1500000)}]},url='/api/imports/source/source',request=(suffix='',headers?:Record<string,string>)=>new Request(`https://example.test${url}${suffix}`,{headers});
  const metadata=await privateJsonResponse(request('?transfer=1'),value,'source',url).json();expect(metadata.bytes).toBeGreaterThan(STORAGE_LIMITS.chunkBytes);
  expect(()=>privateJsonResponse(request(),value,'source',url)).toThrow();const parts:Buffer[]=[];
  for(let start=0;start<metadata.bytes;start+=STORAGE_LIMITS.chunkBytes){const end=Math.min(start+STORAGE_LIMITS.chunkBytes-1,metadata.bytes-1),response=privateJsonResponse(request('',{range:`bytes=${start}-${end}`,'if-match':metadata.etag}),value,'source',url);expect(response.status).toBe(206);expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${metadata.bytes}`);const bytes=Buffer.from(await response.arrayBuffer());expect(bytes.length).toBeLessThanOrEqual(STORAGE_LIMITS.chunkBytes);parts.push(bytes);}
  const bytes=Buffer.concat(parts);expect(digest(bytes)).toBe(metadata.sha256);expect(JSON.parse(bytes.toString())).toEqual(value);
 });
 it('refuses stale hash, unbounded/multiple ranges and leaves small DTOs compatible',async()=>{
  const url='https://example.test/api/imports/preview/a?page=1',value={id:'a',rows:[]},m=await privateJsonResponse(new Request(url+'&transfer=1'),value,'a','/api/imports/preview/a?page=1').json();
  expect(await privateJsonResponse(new Request(url),value,'a','/api/imports/preview/a?page=1').json()).toEqual(value);
  expect(()=>privateJsonResponse(new Request(url,{headers:{range:'bytes=0-1','if-match':'"stale"'}}),value,'a','/api/imports/preview/a?page=1')).toThrow();
  for(const range of ['bytes=0-99999999','bytes=0-1,3-4','bytes=-1','bytes=3-1']) expect(()=>privateJsonResponse(new Request(url,{headers:{range,'if-match':m.etag}}),value,'a','/api/imports/preview/a?page=1')).toThrow();
 });
});

it('rechecks current authorization and identical DTO after serialization before returning metadata or bytes', async () => {
  let calls = 0;
  await expect(authorizedPrivateJsonResponse(new Request('https://app.invalid/api/imports/source/x?transfer=1'), async () => {
    if (++calls === 2) throw Object.assign(new Error('revoked'), { status: 404 });
    return { value: 'protected' };
  }, 'x', '/api/imports/source/x')).rejects.toMatchObject({ status: 404 });
  calls = 0;
  await expect(authorizedPrivateJsonResponse(new Request('https://app.invalid/api/imports/source/x?transfer=1'), async () => ({ revision: ++calls }), 'x', '/api/imports/source/x')).rejects.toMatchObject({ status: 412 });
});
