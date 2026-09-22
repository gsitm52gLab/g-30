import { route } from '@/server/http/identity';
import { EvidenceService } from '@/server/evidence/service';
import { enumValue } from '@/domain/tasks/validate';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Context) { return route(request, async (identity, token) => { const q = new URL(request.url).searchParams, mode = enumValue(q.get('mode') ?? 'download', ['download', 'preview']), result = await new EvidenceService(identity).download(token, (await context.params).id, q.get('versionId') ?? '', q.get('linkId') ?? '', mode); return new Response(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.metadata.mime, 'Content-Disposition': `${mode === 'preview' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(result.metadata.name)}`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } }); }); }
