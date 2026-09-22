import { route, json } from "@/server/http/identity";
import { fileReference } from "@/server/files/access";
import { FileService } from "@/server/files/service";
import { fail } from "@/server/auth/errors";
import { MAX_FILE_BYTES, MAX_BATCH_FILES } from "@/domain/files/validate";
export const runtime = "nodejs";
export async function POST(request: Request) {
    return (await route(request, async (identity, token) => {
        const reference = fileReference(new URL(request.url).searchParams);
        await new FileService(identity).checkUpload(token, reference);
        const mime = request.headers.get("content-type");
        if (!mime?.startsWith("multipart/form-data;"))
            fail("VALIDATION", 422, "파일 업로드 형식을 확인해 주세요.");
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
                        fail("VALIDATION", 422, "업로드 한도를 초과했습니다.");
                    }
                    chunks.push(value);
                }
            }
            finally {
                reader.releaseLock();
            }
        let form: FormData;
        try {
            form = await new Response(Buffer.concat(chunks), { headers: { "content-type": mime } }).formData();
        }
        catch {
            fail("VALIDATION", 422, "파일 업로드를 읽지 못했습니다.");
        }
        if ([...form.keys()].some(k => k !== "files" && k !== "visibility"))
            fail("VALIDATION", 422, "허용하지 않은 업로드 항목입니다.");
        const selected = form.getAll("files");
        if (selected.length > MAX_BATCH_FILES || selected.some(f => typeof f === "string"))
            fail("VALIDATION", 422, "한 번에 최대 10개 파일을 선택해 주세요.");
        const visibility = form.get("visibility");
        if (visibility !== "public" && visibility !== "internal")
            fail("VALIDATION", 422, "공개 범위를 선택해 주세요.");
        const files = await Promise.all((selected as File[]).map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
        return json(await new FileService(identity).upload(token, reference, files, visibility), 201);
    }));
}
