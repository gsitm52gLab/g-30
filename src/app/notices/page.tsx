import {NoticePage} from '@/features/notices/server';
import {NoticeListScreen} from '@/features/notices/list';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'공지·가이드'};
export default async function Page({searchParams}:{searchParams:Search}){return <NoticePage searchParams={searchParams}>{contextId=><NoticeListScreen key={contextId} contextId={contextId}/>}</NoticePage>;}
