import { route, json, readBody } from '@/server/http/identity';
import { AiInputService } from '@/server/ai-input/service';
import { id } from '@/domain/ai-input/validate';
export const runtime = 'nodejs';
export async function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (i, t) => { const body = await readBody(request, ['runId']), result = await new AiInputService(i).prepareTransfer(t, (await c.params).id, id(body.runId)); return json(result.allowed ? { allowed: true, extractionHash: result.payload.extractionHash, technicalEstimate: result.technicalEstimate, providerCalled: false, analysisConnected: false } : { allowed: false, reason: result.reason, providerCalled: false, analysisConnected: false }); })); }
