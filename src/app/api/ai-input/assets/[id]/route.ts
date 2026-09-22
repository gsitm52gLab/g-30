import { route } from '@/server/http/identity';
import { AiAssets } from '@/server/ai-input/assets';
import { binary } from '@/server/ai-input/http';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return route(request, async (i, t) => { const r = await new AiAssets(i).download(t, (await c.params).id); return binary(r.bytes, r.metadata.filename, r.metadata.mime); }); }
