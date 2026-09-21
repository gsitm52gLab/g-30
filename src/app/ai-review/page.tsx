import {ReviewPage} from '@/features/ai-review/server';
import type {Search} from '@/server/workspace';
export const dynamic='force-dynamic';
export default function Page({searchParams}:{searchParams:Search}){return <ReviewPage kind='list' searchParams={searchParams}/>;}
