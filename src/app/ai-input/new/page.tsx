import {AiInputPage} from '@/features/ai-input/server';
import {AiInputScreen} from '@/features/ai-input/screen';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'새 AI 입력'};
export default async function Page({searchParams}:{searchParams:Search}){return <AiInputPage searchParams={searchParams}>{contextId=><AiInputScreen key={contextId} contextId={contextId}/>}</AiInputPage>;}
