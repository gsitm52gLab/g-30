export function correctionFileUrls(id:string,batchVersionId:string,itemKey:string,preview:boolean,reflectionId?:string){
    const q=new URLSearchParams({batchVersionId,itemKey,...reflectionId?{reflectionId}:{}}),base=`/api/corrections/files/${encodeURIComponent(id)}?${q}`;
    return {originalUrl:base+'&mode=original',downloadUrl:base+'&mode=download',previewUrl:preview?base+'&mode=preview':null};
}
