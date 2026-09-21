import {ReviewPage} from '@/features/ai-review/server';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Search}){const{id}=await params;return <ReviewPage kind='run' id={id} searchParams={searchParams}/>;}
