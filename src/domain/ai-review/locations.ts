import { EXTRACTION_VERSION, INPUT_LIMITS, type Box, type ExtractionSnapshot } from '../ai-input/types';
import type { VerifiedQuote } from './types';
import { array, contentHash, hash, id, integer, invalid, object, oneOf, text } from './validate';

function nullableInteger(v: unknown, minimum: number) { return v === null ? null : integer(v, minimum, 2_000_000); }
function box(value: unknown): Box | null {
  if (value === null) return null; const v = object(value);
  const coordinate = (n: unknown, positive = false) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || positive && n <= 0 || n > 1_000_000) invalid(); return n; };
  return { x: coordinate(v.x), y: coordinate(v.y), width: coordinate(v.width, true), height: coordinate(v.height, true), unit: oneOf(v.unit, ['px', 'pt']) };
}
export function supportedScope(snapshot: ExtractionSnapshot): boolean {
  return snapshot.scope.classification === 'general_cosmetic' && snapshot.scope.language === 'ja' && ['pop', 'leaflet'].includes(snapshot.scope.media);
}
/** Not authorization. Caller first resolves the persisted G15 graph and current source/file permission. */
export function validateSnapshotBinding(snapshot: ExtractionSnapshot, contextId: string, expectedHash: string): void {
  const { snapshotHash, ...body } = snapshot;
  if (hash(expectedHash) !== hash(snapshotHash) || contentHash(body) !== expectedHash || snapshot.schemaVersion !== EXTRACTION_VERSION || snapshot.textOffsets !== 'UTF-16-code-units') invalid('LOCATION_INVALID');
  const sources = array(snapshot.sources, INPUT_LIMITS.images);
  if (!sources.length || sources.some(s => { const source = object(s); return id(source.contextId) !== id(contextId); })) invalid('LOCATION_INVALID');
  const keys = sources.map(s => { const v = object(s); hash(v.sha256); return `${id(v.sourceId)}:${id(v.versionId)}`; });
  if (new Set(keys).size !== keys.length) invalid('LOCATION_INVALID');
}
function resolveQuote(snapshot: ExtractionSnapshot, value: unknown): VerifiedQuote {
  if (!supportedScope(snapshot) || !['read', 'partial'].includes(snapshot.status)) invalid();
  const q = object(value), segmentId = id(q.segmentId), quote = text(q.quote, 5000), start = integer(q.start), end = integer(q.end);
  const matching = array(snapshot.segments, INPUT_LIMITS.segments).map(object).filter(s => s.id === segmentId);
  if (matching.length !== 1) invalid();
  const segment = matching[0], segmentText = text(segment.text, 2_000_000), fullText = text(snapshot.text, 2_000_000);
  const textStart = integer(segment.textStart), textEnd = integer(segment.textEnd), l = object(segment.location);
  if (start >= end || end > segmentText.length || segmentText.slice(start, end) !== quote || !segmentText.slice(0, start).isWellFormed() || !segmentText.slice(0, end).isWellFormed() || textEnd - textStart !== segmentText.length || fullText.slice(textStart, textEnd) !== segmentText) invalid();
  const sourceId = id(l.sourceId), versionId = id(l.versionId), page = nullableInteger(l.page, 1), imageIndex = nullableInteger(l.imageIndex, 0);
  const source = snapshot.sources.find(s => s.sourceId === sourceId && s.versionId === versionId); if (!source) invalid();
  const units = array(snapshot.units, 20_004).map(object).filter(u => u.sourceId === sourceId && u.versionId === versionId && u.page === page && u.imageIndex === imageIndex);
  if (units.length !== 1) invalid(); const unit = units[0];
  const coverage = oneOf(unit.coverage, ['plain_text', 'pdf_text_layer', 'ocr_partial']);
  oneOf(unit.status, ['read', 'partial']);
  if (!array(unit.segmentIds, INPUT_LIMITS.segments).includes(segmentId)) invalid();
  const selected = array(snapshot.selected, INPUT_LIMITS.images).map(object).filter(s => s.sourceId === sourceId);
  if (selected.length !== 1) invalid(); const selection = selected[0];
  if (snapshot.kind === 'pdf' && (page === null || imageIndex !== null || selection.imageIndex !== null || !array(selection.pages, INPUT_LIMITS.selectedPages).includes(page)) || snapshot.kind === 'images' && (page !== null || imageIndex === null || selection.imageIndex !== imageIndex || selection.pages !== null) || snapshot.kind === 'text' && (page !== null || imageIndex !== null || selection.pages !== null || selection.imageIndex !== null)) invalid();
  oneOf(snapshot.kind, ['text', 'pdf', 'images']);
  const b = box(l.box), sourceStart = nullableInteger(l.sourceTextStart, 0), sourceEnd = nullableInteger(l.sourceTextEnd, 0);
  if ((sourceStart === null) !== (sourceEnd === null) || sourceStart !== null && sourceEnd! - sourceStart !== segmentText.length) invalid();
  const confidence = segment.confidence;
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100)) invalid();
  return { segmentId, start, end, quote, textStart: textStart + start, textEnd: textStart + end,
    location: { sourceId, versionId, page, imageIndex, box: b, sourceTextStart: sourceStart === null ? null : sourceStart + start, sourceTextEnd: sourceStart === null ? null : sourceStart + end },
    locationGranularity: sourceStart !== null ? 'text_range' : b ? 'segment_box' : 'segment_page',
    sourceHash: hash(source.sha256), snapshotHash: hash(snapshot.snapshotHash), coverage, segmentConfidence: confidence };
}
/** Local offsets are UTF-16, matching G15. A partial quote retains its enclosing OCR box, never an invented sub-box. */
export function validateInputQuote(snapshot: ExtractionSnapshot, contextId: string, expectedHash: string, value: unknown): VerifiedQuote {
  try { validateSnapshotBinding(snapshot, contextId, expectedHash); return resolveQuote(snapshot, value); }
  catch { return invalid('LOCATION_INVALID'); }
}
