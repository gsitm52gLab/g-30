import { createHash } from "node:crypto";
import { preflight } from "../../../domain/ai-input/preflight";
import { EXTRACTION_VERSION, INPUT_LIMITS, type ExtractionSnapshot, type SourceIdentity, type Location, type IssueCode } from "../../../domain/ai-input/types";
import { runLocalWorker, type ResourceLimits } from "./process";
export type ExtractionResult = { ok: true; snapshot: ExtractionSnapshot } | { ok: false; status: "rejected" | "out_of_scope"; issue: IssueCode };
export const contentHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const identity = (s: SourceIdentity): SourceIdentity => ({ sourceId: s.sourceId, versionId: s.versionId, contextId: s.contextId, sha256: s.sha256 });
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export function snapshotHash(snapshot: Omit<ExtractionSnapshot, "snapshotHash">): string { return contentHash(JSON.stringify(snapshot)); }
/** Node-only standalone extraction. No database, provider, remote asset fetch or environment credential is consumed. */
export async function extractInput(input: unknown, limits?: ResourceLimits): Promise<ExtractionResult> {
  const validated = preflight(input); if (!validated.ok) return validated;
  const request = validated.request, kind = request.kind, originals = request.kind === "images" ? request.sources : [request.source];
  // Copy before the first await; mutable caller buffers cannot change admitted bytes mid-extraction.
  const bytes = request.kind === "text" ? [] : (request.kind === "pdf" ? [request.source] : request.sources).map(s => Buffer.from(s.bytes));
  if (originals.some((s, i) => contentHash(request.kind === "text" ? request.text : bytes[i]) !== s.sha256)) return { ok: false, status: "rejected", issue: "SOURCE_CHANGED" };
  const sources = originals.map(identity), scope = { classification: request.scope.classification, language: request.scope.language, media: request.scope.media, use: request.scope.use };
  const selected = request.kind === "pdf" ? [{ sourceId: sources[0].sourceId, pages: [...request.selectedPages].sort((a,b) => a-b), imageIndex: null }] : sources.map((s, i) => ({ sourceId: s.sourceId, pages: null, imageIndex: kind === "images" ? i : null }));
  const body: Omit<ExtractionSnapshot, "snapshotHash"> = { schemaVersion: EXTRACTION_VERSION, scope, kind: kind, sources, status: "unread", issues: [], selected, units: [], segments: [], text: "", textOffsets: "UTF-16-code-units", characterCount: 0, tokenEstimate: { method: "utf8-byte-conservative-estimate", modelTokenizer: null, value: 0, limit: INPUT_LIMITS.tokenEstimate, modelValidationRequired: true }, engines: { pdf: "not_used", raster: "not_used", ocr: "not_used", language: "jpn", languageAssetSha256: null }, requiresHumanReview: true, providerCalled: false };
  const location = (s: SourceIdentity, page: number | null, imageIndex: number | null): Location => ({ sourceId: s.sourceId, versionId: s.versionId, page, imageIndex, box: null, sourceTextStart: null, sourceTextEnd: null });
  if (request.kind === "text") {
    body.segments.push({ id: "s1", text: request.text, method: "text", confidence: null, location: { ...location(sources[0], null, null), sourceTextStart: 0, sourceTextEnd: request.text.length }, textStart: 0, textEnd: request.text.length });
    body.units.push({ sourceId: sources[0].sourceId, versionId: sources[0].versionId, page: null, imageIndex: null, status: "read", coverage: "plain_text", segmentIds: ["s1"], unread: [] });
  } else {
    const result = await runLocalWorker(kind === "pdf" ? { kind: "pdf", bytes: bytes[0].toString("base64"), selectedPages: selected[0].pages } : { kind: "images", images: bytes.map(b => b.toString("base64")) }, limits);
    if (result.engines) body.engines = result.engines;
    if (result.issue) body.issues.push(result.issue);
    for (const u of result.units) {
      const source = sources[u.imageIndex ?? 0], base = location(source, u.page, u.imageIndex), segmentIds: string[] = [];
      for (const s of u.segments) {
        const id = `s${body.segments.length + 1}`; segmentIds.push(id);
        body.segments.push({ id, text: s.text, method: s.method, confidence: s.confidence, location: { ...base, box: s.box }, textStart: 0, textEnd: 0 });
      }
      body.units.push({ sourceId: source.sourceId, versionId: source.versionId, page: u.page, imageIndex: u.imageIndex, status: u.status, coverage: u.coverage, segmentIds, unread: u.unread.map(x => ({ code: x.code, confidence: x.confidence, location: { ...base, box: x.box } })) });
    }
    const expected = kind === "pdf" ? selected[0].pages!.map(page => ({ source: sources[0], page, imageIndex: null })) : sources.map((source, imageIndex) => ({ source, page: null, imageIndex }));
    for (const e of expected) if (!body.units.some(u => u.page === e.page && u.imageIndex === e.imageIndex)) body.units.push({ sourceId: e.source.sourceId, versionId: e.source.versionId, page: e.page, imageIndex: e.imageIndex, status: "unread", coverage: "none", segmentIds: [], unread: [{ code: result.issue ?? "WORKER_FAILED", confidence: null, location: location(e.source, e.page, e.imageIndex) }] });
    if (kind === "pdf" && result.pageCount !== null) for (let page=1; page<=result.pageCount; page++) if (!selected[0].pages!.includes(page)) body.units.push({ sourceId: sources[0].sourceId, versionId: sources[0].versionId, page, imageIndex: null, status: "unselected", coverage: "none", segmentIds: [], unread: [] });
    body.units.sort((a,b) => (a.page ?? a.imageIndex ?? 0) - (b.page ?? b.imageIndex ?? 0));
  }
  for (const s of body.segments) { if (body.text) body.text += "\n"; s.textStart = body.text.length; body.text += s.text; s.textEnd = body.text.length; }
  body.characterCount = [...body.text].length;
  body.tokenEstimate.value = Buffer.byteLength(body.text, "utf8");
  body.issues = [...new Set([...body.issues, ...body.units.flatMap(u => u.unread.map(x => x.code))])];
  body.status = !body.segments.length ? "unread" : body.issues.length || body.units.some(u => u.status === "partial" || u.status === "unread") ? "partial" : "read";
  if (body.tokenEstimate.value > INPUT_LIMITS.tokenEstimate) { body.status = "rejected"; body.issues.push("TOKEN_LIMIT"); }
  return { ok: true, snapshot: deepFreeze({ ...body, snapshotHash: snapshotHash(body) }) };
}
