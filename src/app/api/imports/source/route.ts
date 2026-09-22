import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { importLimits } from '@/domain/imports/types';
import { fail } from '@/server/auth/errors';
export const runtime = 'nodejs';
export function POST(request: Request) {
    return route(request, async (identity, token) => {
        const contextId = new URL(request.url).searchParams.get('context') ?? '', service = new ImportService(identity);
        await service.configuration(token, contextId);
        const mime = request.headers.get('content-type');
        if (!mime?.startsWith('multipart/form-data;'))
            fail('VALIDATION', 422, 'Excel 파일을 선택해 주세요.');
        const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > importLimits.inputBytes + 65536) {
                        await reader.cancel();
                        fail('RESOURCE_LIMIT', 422, '10MiB 이하의 파일을 선택해 주세요.');
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
            fail('VALIDATION', 422, '업로드를 읽지 못했습니다.');
        }
        if ([...form.keys()].some(k => k !== 'file') || form.getAll('file').length !== 1)
            fail('VALIDATION', 422, 'Excel 파일 1개를 선택해 주세요.');
        const file = form.get('file');
        if (!file || typeof file === 'string')
            fail('VALIDATION', 422, '파일을 선택해 주세요.');
        return json(await service.inspect(token, contextId, file.name, Buffer.from(await file.arrayBuffer())), 201);
    });
}
