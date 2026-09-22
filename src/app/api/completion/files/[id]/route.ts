import { route } from '@/server/http/identity';
import { CompletionFiles } from '@/server/completion/files';
export const runtime = 'nodejs';
export async function GET(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(request, async (s, t) => { const q = new URL(request.url).searchParams, { bytes, metadata } = await new CompletionFiles(s).download(t, (await c.params).id, q); return new Response(bytes, { headers: { 'Content-Type': metadata.mime, 'Content-Length': String(bytes.length), 'Content-Disposition': `${q.get('mode') === 'preview' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } }); })); }
