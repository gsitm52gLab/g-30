import type { UploadCapability } from '@/domain/storage/types';
import { FileTransferError, type DirectUploadCallbacks } from './contracts';
export { boundedDownload, downloadMetadata } from './download';
export type { DirectUploadCallbacks, DownloadMetadata, TransferFileInput, IssuedUpload } from './contracts';
export interface UploadResumeState { grantId?: string; fileFingerprint?: string; uploaded?: boolean; tusUrl?: string }
const TUS_CHUNK = 6 * 1024 * 1024;
const accessStatus = (error: unknown): number | undefined => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && [401,403,404].includes(error.status) ? error.status : undefined;
const invalid = (): never => { throw new FileTransferError('INVALID_INPUT'); };
function capability(value: UploadCapability, bytes: number): UploadCapability {
  const signed = new URL(value.signedUrl), tus = new URL(value.resumableEndpoint);
  if (signed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(signed.hostname) || signed.port || signed.username || signed.password || signed.hash
    || signed.pathname !== `/storage/v1/object/upload/sign/${value.bucket}/${value.key}` || [...signed.searchParams.keys()].some(k => k !== 'token') || signed.searchParams.get('token') !== value.token
    || tus.origin !== signed.origin.replace('.supabase.co', '.storage.supabase.co') || tus.pathname !== '/storage/v1/upload/resumable/sign' || tus.search || tus.hash
    || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value.bucket) || !/^[a-z0-9][a-z0-9_-]{0,63}\/staging\/[a-f0-9-]{36}$/.test(value.key)
    || value.method !== 'PUT' || value.tusChunkBytes !== TUS_CHUNK || value.expectedBytes !== bytes || value.bucketMaxBytes < bytes || !value.token) invalid();
  if (!Number.isSafeInteger(value.appExpiresAt) || Date.now() >= value.appExpiresAt) throw new FileTransferError('EXPIRED');
  return value;
}
function resumeURL(value: string, cap: UploadCapability): string {
  const url = new URL(value, cap.resumableEndpoint), base = new URL(cap.resumableEndpoint);
  if (url.origin !== base.origin || !url.pathname.startsWith('/storage/v1/upload/resumable/') || url.username || url.password || url.search || url.hash) invalid();
  return url.href;
}
const offsetOf = (response: Response, total: number) => { const raw=response.headers.get('upload-offset'); if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw)>total) invalid(); return Number(raw); };
/** Upload-only capabilities live in memory. Caller retains the same clientItemId/state for retry.
 * Every retry obtains current feature status; ready replay resolves the current-authorized feature DTO.
 * No local fallback or unbounded automatic retries; a failed item remains independently retryable.
 */
export async function directUpload<T>(file: File, options: {
  clientItemId: string; callbacks: DirectUploadCallbacks<T>; state?: UploadResumeState;
  signal?: AbortSignal; maximumBytes?: number; onProgress?: (bytes: number, total: number) => void; fetcher?: typeof fetch;
}): Promise<T> {
  const { callbacks, signal } = options, state = options.state ?? {}, fetcher=options.fetcher ?? fetch;
  const send = (url: string, init: RequestInit) => fetcher(url, { ...init, credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  const resolveReady = async (status: import('@/domain/storage/types').GrantStatus) => {
    signal?.throwIfAborted();
    const result = await callbacks.resolve(status, signal);
    signal?.throwIfAborted();
    return result;
  };
  const finalize = async (id: string) => {
    let status;
    try { status = await callbacks.finalize(id, signal); }
    catch (error) { if (accessStatus(error)) throw new FileTransferError('ACCESS_CHANGED', accessStatus(error)); signal?.throwIfAborted(); status = await callbacks.status(id, signal); }
    if (status.id !== id || status.state !== 'ready' || !status.result) throw new FileTransferError('NOT_READY');
    return await resolveReady(status);
  };
  try {
    signal?.throwIfAborted();
    const maximum = options.maximumBytes ?? 25*1024*1024;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > maximum || !/^[a-zA-Z0-9_-]{1,160}$/.test(options.clientItemId)) invalid();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''); signal?.throwIfAborted();
    const fingerprint = JSON.stringify([file.name,file.type,file.size,sha256]);
    if (state.grantId && state.fileFingerprint !== fingerprint) invalid();
    state.fileFingerprint = fingerprint;
    if (state.grantId) {
      const status = await callbacks.status(state.grantId, signal);
      if (status.id !== state.grantId) invalid();
      if (status.state === 'ready') { if (!status.result) invalid(); return await resolveReady(status); }
      if (state.uploaded || status.state === 'recovery_required' || status.state === 'finalizing') return await finalize(status.id);
      if (!['issued','issuing'].includes(status.state)) throw new FileTransferError('NOT_READY');
    }
    const issued = await callbacks.issue({ clientItemId: options.clientItemId, originalName:file.name, declaredMime:file.type, expectedBytes:file.size, expectedSha256:sha256 }, signal);
    if (state.grantId && issued.status.id !== state.grantId) invalid(); state.grantId=issued.status.id;
    if (issued.status.state === 'ready') { if (!issued.status.result) invalid(); return await resolveReady(issued.status); }
    if (issued.status.state !== 'issued' || !issued.capability) throw new FileTransferError('NOT_READY');
    const cap = capability(issued.capability, file.size);
    if (file.size <= TUS_CHUNK) {
      const response=await send(cap.signedUrl,{method:'PUT',body:file,headers:{'content-type':file.type||'application/octet-stream'}}), code=response.status; await response.body?.cancel();
      // Supabase reports an existing signed object as HTTP400 (independently observed).
      // Both400/409 are ambiguous here: ONLY exact-byte server finalize may accept them.
      if (code!==200 && code!==400 && code!==409) throw new FileTransferError('TRANSFER_FAILED');
      options.onProgress?.(file.size,file.size);
    } else {
      let offset=0;
      if (state.tusUrl) {
        state.tusUrl=resumeURL(state.tusUrl,cap);
        const response=await send(state.tusUrl,{method:'HEAD',headers:{'tus-resumable':'1.0.0','x-signature':cap.token}});
        if (response.status===404 || response.status===410) state.tusUrl=undefined;
        else { if(response.status!==200) {await response.body?.cancel();throw new FileTransferError('TRANSFER_FAILED');} try { offset=offsetOf(response,file.size); } finally { await response.body?.cancel(); } }
        await response.body?.cancel();
      }
      if (!state.tusUrl) {
        const metadata={bucketName:cap.bucket,objectName:cap.key,contentType:file.type||'application/octet-stream',cacheControl:'0'};
        const response=await send(cap.resumableEndpoint,{method:'POST',headers:{'tus-resumable':'1.0.0','upload-length':String(file.size),'upload-metadata':Object.entries(metadata).map(([k,v])=>`${k} ${btoa(v)}`).join(','),'x-signature':cap.token}});
        const location=response.headers.get('location'), code=response.status;await response.body?.cancel();
        if(code!==201||!location)throw new FileTransferError('TRANSFER_FAILED');state.tusUrl=resumeURL(location,cap);
      }
      while(offset<file.size) {
        signal?.throwIfAborted();const end=Math.min(offset+TUS_CHUNK,file.size);
        const response=await send(state.tusUrl,{method:'PATCH',body:file.slice(offset,end),headers:{'tus-resumable':'1.0.0','upload-offset':String(offset),'content-type':'application/offset+octet-stream','x-signature':cap.token}});
        let next: number; const code=response.status;try { next=offsetOf(response,file.size); } finally { await response.body?.cancel(); }
        if(code!==204||next!==end)throw new FileTransferError('TRANSFER_FAILED');offset=next;options.onProgress?.(offset,file.size);
      }
    }
    state.uploaded=true;signal?.throwIfAborted();return await finalize(issued.status.id);
  } catch(error) { if(signal?.aborted)throw new FileTransferError('ABORTED'); if(error instanceof FileTransferError)throw error;if(accessStatus(error))throw new FileTransferError('ACCESS_CHANGED',accessStatus(error));throw new FileTransferError('TRANSFER_FAILED'); }
}
