import { route, json, readBody } from '@/server/http/identity';
import { SubmissionService } from '@/server/submissions/service';
export function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (identity, token) => json(await new SubmissionService(identity).evaluate(token, (await context.params).id, await readBody(request, ['baseRequestId', 'content'], 1048576)))); }
