import { route, json } from '@/server/http/identity';
import { SubmissionService } from '@/server/submissions/service';
export function GET(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (identity, token) => json(await new SubmissionService(identity).snapshot(token, (await context.params).id))); }
