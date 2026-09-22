import {InquiryPage} from '@/features/inquiries/server';
import {InquirySurface} from '@/features/inquiries/surface';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Search}){const {id}=await params;return <InquiryPage searchParams={searchParams}>{contextId=><InquirySurface key={`${contextId}-${id}`} id={id} contextId={contextId}/>}</InquiryPage>;}
