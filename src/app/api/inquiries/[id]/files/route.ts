import { route, json } from '@/server/http/identity';
import { InquiryFiles } from '@/server/inquiries/files';
import { fail } from '@/server/auth/errors';
import { MAX_FILE_BYTES, MAX_BATCH_FILES } from '@/domain/files/validate';
export const runtime = 'nodejs';
export async function POST(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) {
    return (await route(request, async (identity, token) => {
        const taskId = (await context.params).id, query = new URL(request.url).searchParams, rawVisibility = query.get('visibility') ?? 'public';
        if ([...query.keys()].some(k => k !== 'visibility') || query.getAll('visibility').length > 1 || !['public', 'internal'].includes(rawVisibility))
            fail('VALIDATION', 422, '파일 공개 범위를 하나만 지정해 주세요.');
        const visibility = rawVisibility as 'public' | 'internal', service = new InquiryFiles(identity);
        await service.check(token, taskId, visibility);
        const mime = request.headers.get('content-type');
        if (!mime?.startsWith('multipart/form-data;'))
            fail('VALIDATION', 422, '파일 업로드 형식을 확인해 주세요.');
        const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > MAX_FILE_BYTES * MAX_BATCH_FILES + 65536) {
                        await reader.cancel();
                        fail('VALIDATION', 422, '업로드 한도를 초과했습니다.');
                    }
                    chunks.push(value);
                }
            }
            finally {
                reader.releaseLock();
            }
        let form: FormData;
        try {
            form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': mime } }).formData();
        }
        catch {
            fail('VALIDATION', 422, '파일 업로드를 읽지 못했습니다.');
        }
        if ([...form.keys()].some(k => k !== 'files' && k !== 'clientItemIds'))
            fail('VALIDATION', 422, '허용하지 않은 업로드 항목입니다.');
        const files = form.getAll('files'), itemIds = form.getAll('clientItemIds');
        if (!files.length || files.length > 10 || files.length !== itemIds.length || files.some(f => typeof f === 'string') || itemIds.some(v => typeof v !== 'string'))
            fail('VALIDATION', 422, '파일과 재시도 키를 같은 순서로 1~10개 보내 주세요.');
        return json(await service.upload(token, taskId, await Promise.all((files as File[]).map(async (f, i) => ({ clientItemId: itemIds[i] as string, name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) }))), visibility));
    }));
}
