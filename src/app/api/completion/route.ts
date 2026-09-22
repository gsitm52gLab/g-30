import { route, json, readBody } from '@/server/http/identity';
import { CompletionService } from '@/server/completion/service';
import { commandKeys } from '@/domain/completion/validate';
import { fail } from '@/server/auth/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
    return (await route(request, async (s, t) => {
        const q = new URL(request.url).searchParams;
        if ([...q.keys()].some(k => k !== 'taskId') || q.getAll('taskId').length !== 1 || !q.get('taskId'))
            fail('VALIDATION', 422, '업무 하나를 선택해 주세요.');
        return json(await new CompletionService(s).workspace(t, q.get('taskId')!));
    }));
}
export async function POST(request: Request) { return (await route(request, async (s, t) => json(await new CompletionService(s).command(t, await readBody(request, commandKeys, 128 * 1024))))); }
