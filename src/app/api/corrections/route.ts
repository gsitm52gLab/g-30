import { route, json, readBody } from '@/server/http/identity';
import { CorrectionService } from '@/server/corrections/service';
import { fail } from '@/server/auth/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) { return route(request, async (s, t) => { const q = new URL(request.url).searchParams; if ([...q.keys()].some(k => k !== 'taskId') || q.getAll('taskId').length !== 1 || !q.get('taskId'))
    fail('VALIDATION', 422, '업무를 하나만 선택해 주세요.'); return json(await new CorrectionService(s).workspace(t, q.get('taskId')!)); }); }
export async function POST(request: Request) { return route(request, async (s, t) => json(await new CorrectionService(s).command(t, await readBody(request, ['command', 'taskId', 'idempotencyKey', 'opinionId', 'expectedRevision', 'opinion', 'draftId', 'draft', 'batchVersionId', 'items', 'target', 'source', 'scope', 'receivedOn', 'result', 'rationale', 'evidenceFileVersionIds', 'previousReviewId'], 2097152)))); }
