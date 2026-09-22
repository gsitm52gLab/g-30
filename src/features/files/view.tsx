'use client';
/* eslint-disable @next/next/no-img-element -- Authorized bounded bytes are verified before creating a local Blob URL. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { boundedDownload } from './download';
import { FileTransferError } from './contracts';
/** The URL always stays an authenticated application reference, never a public Storage URL. */
type Props={href:string;children:ReactNode;preview?:boolean;className?:string};
export function FileLink(props:Props){return <FileLinkContent key={props.href} {...props}/>;}
function FileLinkContent({href,children,preview=false,className}:Props) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[shown,setShown]=useState<{url:string;mime:string;name:string;href:string}|null>(null);
  const turn=useRef(0),controller=useRef<AbortController|null>(null),object=useRef<string|null>(null);
  const clear=()=>{controller.current?.abort();controller.current=null;if(object.current)URL.revokeObjectURL(object.current);object.current=null;};
  useEffect(()=>{return()=>{clear();};},[]);
  async function open(){if(busy)return;const id=++turn.current;clear();setShown(null);setBusy(true);setError('');const c=new AbortController();controller.current=c;
    try{const u=new URL(href,location.origin);u.searchParams.set('metadata','1');const {blob,metadata}=await boundedDownload(u.pathname+u.search,{signal:c.signal,maximumBytes:25*1024*1024});if(id!==turn.current||c.signal.aborted)return;const url=URL.createObjectURL(blob);object.current=url;
      if(preview&&(metadata.mime==='application/pdf'||['image/png','image/jpeg'].includes(metadata.mime)))setShown({url,mime:metadata.mime,name:metadata.name,href});
      else{const a=document.createElement('a');a.href=url;a.download=metadata.name;a.click();}
    }catch(e){if(id===turn.current&&!c.signal.aborted){clear();setShown(null);setError(e instanceof FileTransferError?e.message:'파일을 읽지 못했습니다. 현재 권한을 확인한 뒤 다시 시도해 주세요.');}}
    finally{if(id===turn.current&&!c.signal.aborted)setBusy(false);}
  }
  function close(){turn.current++;clear();setShown(null);setBusy(false);}
  return <span style={{maxWidth:'100%',overflowWrap:'anywhere'}}><button type="button" className={className} onClick={()=>void open()} disabled={busy}>{busy?'파일 확인 중…':children}</button>{busy&&<button type="button" onClick={close}>파일 처리 취소</button>}{error&&<span role="alert">{error}</span>}{shown?.href===href&&<span role="region" aria-label={`${shown.name} 미리보기`} style={{display:'block',maxWidth:'100%'}}><button type="button" onClick={close}>미리보기 닫기</button>{shown.mime==='application/pdf'?<iframe title={`${shown.name} PDF 미리보기`} sandbox="" src={shown.url} style={{width:'100%',height:480,border:0}}/>:<img alt={shown.name} src={shown.url} style={{maxWidth:'100%',height:'auto'}}/>}</span>}</span>;
}
