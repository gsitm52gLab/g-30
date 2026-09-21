import { route, json, readBody } from '@/server/http/identity';
import { SubmissionService } from '@/server/submissions/service';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export function GET(request: Request, context: Context) { return route(request, async (identity, token) => json(await new SubmissionService(identity).workspace(token, (await context.params).id))); }
export function POST(request: Request, context: Context) { return route(request, async (identity, token) => json(await new SubmissionService(identity).submit(token, (await context.params).id, await readBody(request, ['baseRequestId', 'expectedDraftRevision', 'expectedTaskRevision', 'mode', 'idempotencyKey'])), 201)); }
