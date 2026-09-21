import { route } from '@/server/http/identity';
import { AuthError,fail } from '@/server/auth/errors';
import { InquiryService } from '@/server/inquiries/service';
export const runtime='nodejs';
export function GET(request:Request,c:{params:Promise<{id:string}>}){return route(request,async(identity,token)=>{
    const service=new InquiryService(identity),id=(await c.params).id,params=new URL(request.url).searchParams,last=request.headers.get('last-event-id');
    if(last){if(params.has('after')&&params.get('after')!==last)fail('VALIDATION',422,'실시간 연결 위치를 하나만 지정해 주세요.');params.set('after',last);}
    // Validate current access and cursor before returning a stream response.
    await service.events(token,id,params);
    const encoder=new TextEncoder();let closed=false,heartbeat=0,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;
    const stop=()=>{closed=true;if(timer)clearTimeout(timer);wake?.();};request.signal.addEventListener('abort',stop,{once:true});
    const stream=new ReadableStream<Uint8Array>({
        async start(controller){const started=Date.now();
            try{while(!closed&&Date.now()-started<25000){
                // Delivery runs synchronously inside the current authorization UoW, after every await.
                const page=await service.events(token,id,params,page=>{if(closed)return;if(Date.now()-heartbeat>5000){controller.enqueue(encoder.encode(': connected\n\n'));heartbeat=Date.now();}for(const event of page.events)controller.enqueue(encoder.encode(`id: ${event.cursor}\nevent: inquiry\ndata: ${JSON.stringify(event)}\n\n`));});
                params.set('after',page.cursor);
                if(!page.hasMore)await new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,250);});
            }}catch(error){if(!closed)controller.enqueue(encoder.encode(`event: unavailable\ndata: ${JSON.stringify({error:{code:error instanceof AuthError?error.code:'STORAGE_UNAVAILABLE',message:'연결을 다시 확인해 주세요.'}})}\n\n`));}
            finally {request.signal.removeEventListener('abort',stop);stop();try{controller.close();}catch{}}
        },cancel(){stop();request.signal.removeEventListener('abort',stop);}
    });
    return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, private','X-Accel-Buffering':'no','Referrer-Policy':'no-referrer'}});
});}
