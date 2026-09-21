import {InquiryPage} from '@/features/inquiries/server';
import {InquiryListScreen} from '@/features/inquiries/list';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export default function Page({searchParams}:{searchParams:Search}){return <InquiryPage searchParams={searchParams}>{contextId=><InquiryListScreen key={contextId} contextId={contextId}/>}</InquiryPage>;}
