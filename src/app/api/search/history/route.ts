import { route, json } from '@/server/http/identity';
import { fail } from '@/server/auth/errors';
import { SearchService } from '@/server/search/service';
export const runtime = 'nodejs';
export async function GET(request: Request) {
    return route(request, async (s, t) => {
        const q = new URL(request.url).searchParams;
        if ([...q.keys()].some(k => !['context', 'kind', 'id'].includes(k) || q.getAll(k).length !== 1))
            fail('VALIDATION', 422, '정확한 기록을 하나 선택해 주세요.');
        return json(await new SearchService(s).detail(t, q.get('context') ?? '', q.get('kind') ?? '', q.get('id') ?? ''));
    });
}
