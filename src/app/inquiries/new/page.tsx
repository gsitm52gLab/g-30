import {InquiryPage} from '@/features/inquiries/server';
import {NewInquiry} from '@/features/inquiries/new';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Search}){const raw=await searchParams;if(Array.isArray(raw.task))return <p role="alert">연결 업무를 하나만 선택해 주세요.</p>;const taskId=raw.task??null;return <InquiryPage searchParams={searchParams}>{contextId=><NewInquiry key={`${contextId}-${taskId??''}`} contextId={contextId} taskId={taskId}/>}</InquiryPage>;}
