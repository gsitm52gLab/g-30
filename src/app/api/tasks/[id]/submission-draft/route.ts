import { route, json, readBody } from '@/server/http/identity';
import { SubmissionService } from '@/server/submissions/service';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Context) { return (await route(request, async (identity, token) => json(await new SubmissionService(identity).rebasePreview(token, (await context.params).id)))); }
export async function POST(request: Request, context: Context) { return (await route(request, async (identity, token) => json(await new SubmissionService(identity).draft(token, (await context.params).id, await readBody(request, ['command', 'baseRequestId', 'expectedDraftRevision', 'content', 'providedBy', 'idempotencyKey', 'targetRequestId', 'carryAnswers', 'sourceSubmissionId'], 1048576))))); }
