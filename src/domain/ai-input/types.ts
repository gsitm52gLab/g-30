/** Standalone extraction contract v1. No provider call, legal finding or whole-G15 completion. */
export const EXTRACTION_VERSION = "gs-hale-extraction/1" as const;
export const INPUT_LIMITS = Object.freeze({ textCodePoints: 10_000, fileBytes: 10 * 1024 * 1024, selectedPages: 10, images: 4, tokenEstimate: 65_536, pixels: 8_000_000, dimension: 8192, documentPages: 10_000, segments: 20_000, workerMs: 60_000, heapMiB: 256, rssMiB: 768, outputBytes: 2 * 1024 * 1024 });
export type Scope = { classification: string; language: string; media: string; use: string };
export type SourceIdentity = { sourceId: string; versionId: string; contextId: string; sha256: string };
export type BinarySource = SourceIdentity & { filename: string; mime: string; bytes: Uint8Array };
export type ExtractionRequest = { scope: Scope } & (
  | { kind: "text"; source: SourceIdentity; text: string }
  | { kind: "pdf"; source: BinarySource; selectedPages: number[] }
  | { kind: "images"; sources: BinarySource[] });
export type IssueCode = "SCOPE_UNKNOWN" | "OUT_OF_SCOPE" | "INVALID_INPUT" | "EMPTY_INPUT" | "SIZE_LIMIT" | "PAGE_LIMIT" | "IMAGE_LIMIT" | "TYPE_MISMATCH" | "SOURCE_CHANGED" | "PDF_LOCKED" | "PDF_CORRUPT" | "INVALID_SELECTION" | "IMAGE_CORRUPT" | "RESOLUTION_LIMIT" | "NO_TEXT" | "LOW_CONTRAST" | "LOW_CONFIDENCE" | "OCR_COVERAGE_UNKNOWN" | "TEXT_LAYER_UNCERTAIN" | "WORKER_TIMEOUT" | "WORKER_MEMORY" | "WORKER_UNAVAILABLE" | "WORKER_FAILED" | "TOKEN_LIMIT";
export type Box = { x: number; y: number; width: number; height: number; unit: "px" | "pt" };
export type Location = { sourceId: string; versionId: string; page: number | null; imageIndex: number | null; box: Box | null; sourceTextStart: number | null; sourceTextEnd: number | null };
export type Unread = { code: IssueCode; location: Location | null; confidence: number | null };
export type Segment = { id: string; text: string; method: "text" | "pdf_text" | "ocr"; confidence: number | null; location: Location; textStart: number; textEnd: number };
export type ReadUnit = { sourceId: string; versionId: string; page: number | null; imageIndex: number | null; status: "read" | "partial" | "unread" | "unselected"; coverage: "plain_text" | "pdf_text_layer" | "ocr_partial" | "none"; segmentIds: string[]; unread: Unread[] };
export type ExtractionSnapshot = { schemaVersion: typeof EXTRACTION_VERSION; snapshotHash: string; scope: Scope; kind: ExtractionRequest["kind"]; sources: SourceIdentity[]; status: "read" | "partial" | "unread" | "rejected" | "out_of_scope"; issues: IssueCode[]; selected: { sourceId: string; pages: number[] | null; imageIndex: number | null }[]; units: ReadUnit[]; segments: Segment[]; text: string; textOffsets: "UTF-16-code-units"; characterCount: number; tokenEstimate: { method: "utf8-byte-conservative-estimate"; modelTokenizer: null; value: number; limit: number; modelValidationRequired: true }; engines: { pdf: string; raster: string; ocr: string; language: string; languageAssetSha256: string | null }; requiresHumanReview: true; providerCalled: false };
export type Preflight = { ok: true; request: ExtractionRequest } | { ok: false; status: "rejected" | "out_of_scope"; issue: IssueCode };
/** Must be produced by current server authorization, never accepted as a client assertion. */
export type CurrentTransferDecision = SourceIdentity & { verifiedSnapshotHash: string; currentReadAllowed: boolean; externalUseAllowed: boolean; provenance: "synthetic" | "licensed_public" | "confidential" | "unknown"; checkedAt: string };
