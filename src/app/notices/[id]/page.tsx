import {NoticePage} from '@/features/notices/server';
import {NoticeScreen} from '@/features/notices/detail';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'공지 상세'};
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Search}){const {id}=await params;return <NoticePage searchParams={searchParams}>{contextId=><NoticeScreen key={`${id}:${contextId}`} id={id} contextId={contextId}/>}</NoticePage>;}
