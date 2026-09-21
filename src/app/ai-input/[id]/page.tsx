import {AiInputPage} from '@/features/ai-input/server';
import {AiInputScreen} from '@/features/ai-input/screen';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export const metadata={title:'저장된 AI 입력'};
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Search}){const {id}=await params;return <AiInputPage searchParams={searchParams}>{contextId=><AiInputScreen key={`${contextId}:${id}`} contextId={contextId} inputId={id}/>}</AiInputPage>;}
