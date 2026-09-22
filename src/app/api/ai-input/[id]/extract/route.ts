import { route, json, readBody } from '@/server/http/identity';
import { AiInputService } from '@/server/ai-input/service';
export const runtime = 'nodejs';
export async function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => json(await new AiInputService(i).extract(t, (await c.params).id, await readBody(request, ['versionId', 'expectedRunId', 'idempotencyKey'], 100000))))); }
