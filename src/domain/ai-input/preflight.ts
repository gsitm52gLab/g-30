import { INPUT_LIMITS, type BinarySource, type ExtractionRequest, type Preflight, type SourceIdentity } from "./types";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const identity = (v: unknown): v is SourceIdentity & Record<string, unknown> => object(v) && id(v.sourceId) && id(v.versionId) && id(v.contextId) && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256);
const reject = (issue: Exclude<Preflight, { ok: true }>["issue"]): Preflight => ({ ok: false, status: "rejected", issue });
function binary(v: unknown, kind: "pdf" | "images"): Preflight | null {
  if (!identity(v) || !object(v) || !id(v.filename) || typeof v.mime !== "string" || !(v.bytes instanceof Uint8Array)) return reject("INVALID_INPUT");
  if (!v.bytes.length) return reject("EMPTY_INPUT");
  if (v.bytes.length > INPUT_LIMITS.fileBytes) return reject("SIZE_LIMIT");
  const b = v.bytes, ext = v.filename.toLowerCase().split(".").at(-1);
  const png = b.length >= 8 && [137,80,78,71,13,10,26,10].every((x,i) => b[i] === x), jpg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  const ascii = (a:number,z:number) => String.fromCharCode(...b.subarray(a,z));
  const valid = kind === "pdf" ? ext === "pdf" && v.mime === "application/pdf" && ascii(0,5) === "%PDF-" : ext === "png" && v.mime === "image/png" && png || ["jpg","jpeg"].includes(ext ?? "") && v.mime === "image/jpeg" && jpg || ext === "webp" && v.mime === "image/webp" && ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP";
  return valid ? null : reject("TYPE_MISMATCH");
}
export function preflight(input: unknown): Preflight {
  if (!object(input) || !object(input.scope)) return reject("INVALID_INPUT");
  const s = input.scope;
  if (s.classification === "unknown" || !id(s.classification)) return { ok:false,status:"out_of_scope",issue:"SCOPE_UNKNOWN" };
  if (s.classification !== "general_cosmetic" || s.language !== "ja" || (typeof s.media !== "string" || !["pop","leaflet"].includes(s.media))) return {ok:false,status:"out_of_scope",issue:"OUT_OF_SCOPE"};
  if (!id(s.use)) return reject("INVALID_INPUT");
  if (input.kind === "text") {
    if (!identity(input.source) || typeof input.text !== "string" || !input.text.isWellFormed()) return reject("INVALID_INPUT");
    if (!input.text.trim()) return reject("EMPTY_INPUT");
    if (Array.from(input.text).length > INPUT_LIMITS.textCodePoints) return reject("SIZE_LIMIT");
  } else if (input.kind === "pdf") {
    const err = binary(input.source,"pdf"); if(err) return err;
    if (!Array.isArray(input.selectedPages) || !input.selectedPages.length || input.selectedPages.some(p => !Number.isSafeInteger(p) || p < 1) || new Set(input.selectedPages).size !== input.selectedPages.length) return reject("INVALID_SELECTION");
    if (input.selectedPages.length > INPUT_LIMITS.selectedPages) return reject("PAGE_LIMIT");
  } else if (input.kind === "images") {
    if (!Array.isArray(input.sources) || !input.sources.length) return reject("EMPTY_INPUT");
    if (input.sources.length > INPUT_LIMITS.images) return reject("IMAGE_LIMIT");
    for(const source of input.sources){ const err=binary(source,"images");if(err)return err; }
    const sources=input.sources as BinarySource[];
    if (sources.reduce((n,s)=>n+s.bytes.length,0)>INPUT_LIMITS.fileBytes) return reject("SIZE_LIMIT");
    if(new Set(sources.map(s=>JSON.stringify([s.sourceId,s.versionId]))).size!==sources.length || new Set(sources.map(s=>s.contextId)).size!==1) return reject("INVALID_INPUT");
  } else return reject("INVALID_INPUT");
  // Admission only; extractInput copies bytes and projects metadata before its first await.
  return {ok:true,request:input as ExtractionRequest};
}
