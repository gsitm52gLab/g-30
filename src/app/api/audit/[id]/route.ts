import { route, json } from '@/server/http/identity';
import { fail } from '@/server/auth/errors';
import { AuditService } from '@/server/audit/service';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await context.params;
    return route(request, async (s, t) => {
        const q = new URL(request.url).searchParams;
        if ([...q.keys()].some(k => k !== 'context' || q.getAll(k).length !== 1))
            fail('VALIDATION', 422, '컨텍스트를 하나 선택해 주세요.');
        return json(await new AuditService(s).detail(t, q.get('context') ?? '', id));
    });
}
