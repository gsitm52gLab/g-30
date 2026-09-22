import { fail } from "@/server/auth/errors";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BATCH_FILES = 10;
const mimeByExtension: Record<string, string[]> = {
    pdf: ["application/pdf"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
    xls: ["application/vnd.ms-excel"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    doc: ["application/msword"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ppt: ["application/vnd.ms-powerpoint"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
    ai: ["application/postscript", "application/pdf", "application/illustrator"], zip: ["application/zip", "application/x-zip-compressed"],
    mp4: ["video/mp4"], mov: ["video/quicktime"],
};
export function validateFileMetadata(name: string, declared: string, bytes: number) {
    if (!name || name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(name) || name === "." || name === "..") fail("VALIDATION", 422, "파일 이름을 확인해 주세요.");
    const extension = name.split(".").pop()?.toLowerCase() ?? "", allowed = mimeByExtension[extension];
    if (!allowed || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_FILE_BYTES) fail("VALIDATION", 422, "허용 형식과 파일당 25MiB 한도를 확인해 주세요.");
    if (declared && declared !== "application/octet-stream" && !allowed.includes(declared.toLowerCase())) fail("VALIDATION", 422, "파일 확장자와 전송 형식이 일치하지 않습니다.");
    return { extension, mime: allowed[0] };
}
export function validateFile(name: string, declared: string, bytes: Buffer) {
    const { extension, mime } = validateFileMetadata(name, declared, bytes.length);
    const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
    const zip = bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,3,4])) || bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,5,6]));
    const ole = bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    let valid = false;
    if (extension === "pdf") valid = pdf;
    if (extension === "png") valid = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (["jpg","jpeg"].includes(extension)) valid = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if (["xls","doc","ppt"].includes(extension)) valid = ole;
    if (["xlsx","docx","pptx"].includes(extension)) valid = zip && bytes.includes(Buffer.from(extension === "xlsx" ? "xl/" : extension === "docx" ? "word/" : "ppt/"));
    if (extension === "zip") valid = zip;
    if (extension === "ai") valid = pdf || bytes.subarray(0,4).toString() === "%!PS";
    if (extension === "mp4" || extension === "mov") valid = bytes.length >= 12 && (bytes.subarray(4,8).toString() === "ftyp" || extension === "mov" && ["moov","mdat","wide"].includes(bytes.subarray(4,8).toString()));
    if (extension === "csv") { try { new TextDecoder("utf-8",{fatal:true}).decode(bytes); valid=!bytes.includes(0); } catch { valid=false; } }
    if (!valid) fail("VALIDATION", 422, "파일 내용과 확장자가 일치하지 않습니다.");
    return { name, mime, preview: ["pdf","png","jpg","jpeg"].includes(extension) };
}
