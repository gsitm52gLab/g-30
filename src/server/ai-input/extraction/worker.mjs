// Isolated local-only process. stdin carries one bounded job; stdout is an NDJSON progress protocol.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require=createRequire(import.meta.url),send=v=>process.stdout.write(JSON.stringify(v)+'\n');
for(const key of ['log','warn','error','info'])console[key]=()=>{};
globalThis.fetch=()=>Promise.reject(Error('NETWORK_DISABLED'));
const L={pixels:8_000_000,dimension:8192,segments:20_000,pages:10_000};
let ocrWorker,document,loadingTask,job,assetHash=null;
const engines={pdf:require('pdfjs-dist/package.json').version,raster:require('@napi-rs/canvas/package.json').version,ocr:require('tesseract.js/package.json').version,language:'jpn',languageAssetSha256:null};
const issue=(code,box=null,confidence=null)=>({code,box,confidence});
const unit=(page,imageIndex,status,coverage,segments=[],unread=[])=>({page,imageIndex,status,coverage,segments,unread});
const sizeOk=(w,h)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=L.dimension&&h<=L.dimension&&w*h<=L.pixels;
async function ocr(canvas,page,imageIndex,scale=1){
 const ctx=canvas.getContext('2d'),{width,height}=canvas,pixels=ctx.getImageData(0,0,width,height).data;let min=255,max=0;
 for(let i=0;i<pixels.length;i+=16){const v=Math.round((pixels[i]+pixels[i+1]+pixels[i+2])/3);min=Math.min(min,v);max=Math.max(max,v);}
 const box={x:0,y:0,width:width/scale,height:height/scale,unit:page===null?'px':'pt'};
 if(max-min<2)return unit(page,imageIndex,'unread','none',[],[issue('NO_TEXT',box)]);
 if(max-min<24)return unit(page,imageIndex,'unread','none',[],[issue('LOW_CONTRAST',box)]);
 if(!ocrWorker){const {createWorker,PSM}=require('tesseract.js');const lang=path.join(path.dirname(require.resolve('@tesseract.js-data/jpn/package.json')),'4.0.0_best_int');assetHash=createHash('sha256').update(readFileSync(path.join(lang,'jpn.traineddata.gz'))).digest('hex');engines.languageAssetSha256=assetHash;
  ocrWorker=await createWorker('jpn',1,{langPath:lang,gzip:true,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});await ocrWorker.setParameters({tessedit_pageseg_mode:PSM.AUTO,preserve_interword_spaces:'1'});
 }
 const {data}=await ocrWorker.recognize(canvas.toBuffer('image/png'),{}, {text:true,blocks:true});const segments=[],unread=[];
 for(const block of data.blocks??[])for(const paragraph of block.paragraphs??[])for(const line of paragraph.lines??[]){
  const text=line.text?.trim();if(!text)continue;const b=line.bbox,bounds={x:b.x0/scale,y:b.y0/scale,width:(b.x1-b.x0)/scale,height:(b.y1-b.y0)/scale,unit:page===null?'px':'pt'},confidence=Number.isFinite(line.confidence)?line.confidence:null;
  if(confidence===null||confidence<70||text.includes('\ufffd'))unread.push(issue('LOW_CONFIDENCE',bounds,confidence));
  else segments.push({text,method:'ocr',confidence,box:bounds});
 }
 if(!segments.length)return unit(page,imageIndex,'unread','none',[],unread.length?unread:[issue('NO_TEXT',box)]);
 // Confidence is an OCR engine score, not proof that all visible text has been detected.
 if(segments.length>L.segments)unread.push(issue('SIZE_LIMIT',box));
 unread.push(issue('OCR_COVERAGE_UNKNOWN',box));
 return unit(page,imageIndex,'partial','ocr_partial',segments.slice(0,L.segments),unread);
}
async function pdf(bytes){
 if(!/%%EOF\s*$/.test(bytes.subarray(Math.max(0,bytes.length-2048)).toString('latin1')))throw Object.assign(Error(),{code:'PDF_CORRUPT'});
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),base=path.dirname(require.resolve('pdfjs-dist/package.json'));
 const task=loadingTask=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true,disableAutoFetch:true,disableStream:true,useSystemFonts:false,verbosity:0,maxImageSize:L.pixels,cMapUrl:path.join(base,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(base,'standard_fonts')+path.sep,wasmUrl:path.join(base,'wasm')+path.sep});
 try{document=await task.promise;}catch(e){throw Object.assign(Error(),{code:e?.name==='PasswordException'?'PDF_LOCKED':'PDF_CORRUPT'});}
 if(await document.getPermissions()!==null)throw Object.assign(Error(),{code:'PDF_LOCKED'});
 if(document.numPages>L.pages)throw Object.assign(Error(),{code:'PAGE_LIMIT'});
 if(job.selectedPages.some(n=>n>document.numPages))throw Object.assign(Error(),{code:'INVALID_SELECTION'});
 send({type:'metadata',pageCount:document.numPages});
 const {createCanvas}=require('@napi-rs/canvas');
 for(const n of job.selectedPages){let page;
  try{page=await document.getPage(n);const viewport=page.getViewport({scale:1}),text=await page.getTextContent(),operators=await page.getOperatorList();const items=text.items.filter(x=>'str'in x);const images=new Set([pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject,pdfjs.OPS.paintImageXObjectRepeat,pdfjs.OPS.paintImageMaskXObjectRepeat]);
   const raster=operators.fnArray.some(x=>images.has(x))||!items.some(x=>x.str.trim())||items.some(x=>x.dir==='ttb');
   if(raster){const scale=2.5,v=page.getViewport({scale}),width=Math.ceil(v.width),height=Math.ceil(v.height);if(!sizeOk(width,height)){send({type:'unit',unit:unit(n,null,'unread','none',[],[issue('RESOLUTION_LIMIT')])});continue;}
    const canvas=createCanvas(width,height);await page.render({canvasContext:canvas.getContext('2d'),canvas,viewport:v}).promise;send({type:'unit',unit:await ocr(canvas,n,null,scale)});canvas.width=1;canvas.height=1;
   }else{const segments=[],unread=[];for(const item of items){if(!item.str.trim())continue;const m=pdfjs.Util.transform(viewport.transform,item.transform),box={x:m[4],y:m[5]-Math.abs(item.height),width:Math.abs(item.width),height:Math.abs(item.height),unit:'pt'};
     if(item.str.includes('\ufffd')||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.str)||Object.values(box).some(v=>typeof v==='number'&&!Number.isFinite(v)))unread.push(issue('TEXT_LAYER_UNCERTAIN',box));else segments.push({text:item.str,method:'pdf_text',confidence:null,box});}
    if(segments.length>L.segments){segments.length=L.segments;unread.push(issue('SIZE_LIMIT'));}send({type:'unit',unit:unit(n,null,segments.length?(unread.length?'partial':'read'):'unread','pdf_text_layer',segments,unread.length?unread:segments.length?[]:[issue('NO_TEXT')])});}
  }catch{send({type:'unit',unit:unit(n,null,'unread','none',[],[issue('PDF_CORRUPT')])});}finally{page?.cleanup();}
 }
}
async function image(bytes,index){const sharp=(await import('sharp')).default;sharp.cache(false);sharp.concurrency(1);const {createCanvas,loadImage}=require('@napi-rs/canvas');
 try{const stream=sharp(bytes,{failOn:'warning',limitInputPixels:L.pixels,unlimited:false}),meta=await stream.metadata();if(!sizeOk(meta.width,meta.height)||(meta.pages??1)>1){send({type:'unit',unit:unit(null,index,'unread','none',[],[issue('RESOLUTION_LIMIT')])});return;}
  // Preserve stored-pixel coordinate orientation. No silent autorotation or downscaling.
  const normalized=await stream.png().toBuffer(),im=await loadImage(normalized),canvas=createCanvas(im.width,im.height);canvas.getContext('2d').fillStyle='white';canvas.getContext('2d').fillRect(0,0,im.width,im.height);canvas.getContext('2d').drawImage(im,0,0);send({type:'unit',unit:await ocr(canvas,null,index)});canvas.width=1;canvas.height=1;
 }catch(e){send({type:'unit',unit:unit(null,index,'unread','none',[],[issue(String(e?.message).includes('pixel limit')?'RESOLUTION_LIMIT':'IMAGE_CORRUPT')])});}}
try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>15*1024*1024)throw Error('INPUT_LIMIT');}job=JSON.parse(input);if(job.kind==='pdf')await pdf(Buffer.from(job.bytes,'base64'));else for(let i=0;i<job.images.length;i++)await image(Buffer.from(job.images[i],'base64'),i);send({type:'done',engines});}
catch(e){send({type:'fatal',code:['PDF_CORRUPT','PDF_LOCKED','INVALID_SELECTION','PAGE_LIMIT'].includes(e?.code)?e.code:'WORKER_FAILED',engines});}
finally{await ocrWorker?.terminate();await loadingTask?.destroy();}
