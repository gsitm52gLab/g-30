import {AiInputPage} from '@/features/ai-input/server';
import {AiInputListScreen} from '@/features/ai-input/screen';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'AI 입력·텍스트 읽기'};
export default async function Page({searchParams}:{searchParams:Search}){return <AiInputPage searchParams={searchParams}>{contextId=><AiInputListScreen key={contextId} contextId={contextId}/>}</AiInputPage>;}
