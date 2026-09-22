import { route, json, readBody } from '@/server/http/identity';
import { NoticeService } from '@/server/notices/service';
import { fail } from '@/server/auth/errors';
export const runtime = 'nodejs';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, c: Context) {
    return route(request, async (s, t) => {
        const q = new URL(request.url).searchParams;
        if (q.getAll('version').length > 1 || q.has('version') && !q.get('version') || q.has('version') && q.get('preview') === '1')
            fail('VALIDATION', 422, '버전을 하나만 지정해 주세요.');
        const service = new NoticeService(s), id = (await c.params).id;
        return json(q.get('preview') === '1' ? await service.preview(t, id) : await service.detail(t, id, q.get('version') ?? undefined));
    });
}
export async function POST(request: Request, c: Context) { return route(request, async (s, t) => json(await new NoticeService(s).command(t, (await c.params).id, await readBody(request, ['command', 'content', 'expectedRevision', 'versionId', 'idempotencyKey'], 65536)))); }
