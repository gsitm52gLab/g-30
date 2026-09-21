import {NoticePage} from '@/features/notices/server';
import {CreateNotice} from '@/features/notices/create';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'공지 작성'};
export default async function Page({searchParams}:{searchParams:Search}){return <NoticePage searchParams={searchParams}>{contextId=><CreateNotice key={contextId} contextId={contextId}/>}</NoticePage>;}
