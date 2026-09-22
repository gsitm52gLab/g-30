import { asyncMap } from "@/domain/async-collections";
import type { Metadata } from 'next';
import Link from 'next/link';
import { currentToken, identity } from '@/server/auth/runtime';
import { TaskService } from '@/server/tasks/service';
import { ProductService } from '@/server/products/service';
import { CampaignService } from '@/server/campaigns/service';
import { AuthError } from '@/server/auth/errors';
import { CampaignSurface } from '@/features/campaigns/surface';
import type { Workspace } from '@/features/campaigns/model';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'PR·행사 | GS HALE' };
export default async function CampaignPage({ params, searchParams }: {
    params: Promise<{
        id: string;
    }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { id } = await params, q = await searchParams;
    let status = 503, message = '행사 자료를 불러오지 못했습니다. 다시 시도해 주세요.', data: Workspace | null = null;
    const valid = Object.entries(q).every(([k, v]) => ['context', 'campaign', 'version'].includes(k) && typeof v === 'string' && !!v) && typeof q.context === 'string' && (!q.version || !!q.campaign);
    if (!valid) {
        status = 422;
        message = '행사 주소와 컨텍스트를 확인해 주세요.';
    }
    else
        try {
            const auth = await identity(), token = await currentToken(), tasks = new TaskService(auth), campaigns = new CampaignService(auth), context = q.context as string, task = await tasks.detail(token, id, context), catalog = await tasks.catalog(token, context), list = await campaigns.list(token, context, id), detail = q.campaign ? await campaigns.detail(token, q.campaign as string, q.version as string | undefined) : null;
            if (detail && (detail.taskId !== id || detail.contextId !== context))
                throw new AuthError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
            data = { task, catalog, list, detail, catalogs: task.canManage ? await campaigns.catalogs(token, context) : null, products: task.canManage ? await Promise.all((await asyncMap(task.task.data.productIds, async (pid) => new ProductService(auth).detail(token, pid, context)))) : [] };
        }
        catch (e) {
            if (e instanceof AuthError) {
                status = e.status;
                message = e.message;
            }
        }
    if (!data)
        return <section className="panel" role="alert"><h1>행사 자료를 열 수 없습니다</h1><p>{message}</p><Link href={status === 401 ? '/login' : '/tasks'}>{status === 401 ? '로그인 확인' : '업무 목록'}</Link></section>;
    return <CampaignSurface key={`${data.catalog.userId}:${id}:${q.campaign ?? ''}:${q.version ?? ''}`} initial={data} selection={q.campaign as string ?? null} version={q.version as string ?? null}/>;
}
