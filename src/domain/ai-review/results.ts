import type { ExtractionSnapshot } from '../ai-input/types';
import { selectCurrentCorpus } from './corpus';
import { supportedScope, validateInputQuote, validateSnapshotBinding } from './locations';
import { CATEGORIES, REVIEW_SCHEMA, type Citation, type CorpusSelection, type CurrentSource, type Finding, type ValidatedResult } from './types';
import { array, id, invalid, object, oneOf, ReviewContractError, sha256, text } from './validate';

export const RESULT_LIMITS = Object.freeze({ rawBytes: 256 * 1024, findings: 100, citationsPerFinding: 20 });
function citations(value: unknown, selection: CorpusSelection): { confirmed: Citation[]; unconfirmed: number } {
  const confirmed: Citation[] = []; let unconfirmed = 0;
  for (const raw of array(value, RESULT_LIMITS.citationsPerFinding)) {
    try {
      const v = object(raw), excerptId = id(v.excerptId), sourceVersionId = id(v.sourceVersionId), locator = text(v.locator);
      const entry = selection.entries.find(e => e.excerpt.id === excerptId && e.source.id === sourceVersionId && e.excerpt.locator === locator);
      if (!entry) { unconfirmed++; continue; }
      if (!confirmed.some(c => c.excerpt.id === excerptId)) confirmed.push({ ...entry, channel: entry.source.authority === 'industry_guidance' ? 'supporting_guidance' : 'legal_basis' });
    } catch { unconfirmed++; }
  }
  return { confirmed, unconfirmed };
}
/** Raw candidate objects are data only. URLs, authority, instructions and locations never come from them. */
export function validateAnalysisResult(raw: string, snapshot: ExtractionSnapshot, contextId: string, expectedSnapshotHash: string, corpus: unknown, currentSources: CurrentSource[]): ValidatedResult {
  if (typeof raw !== 'string' || !raw.isWellFormed() || Buffer.byteLength(raw, 'utf8') > RESULT_LIMITS.rawBytes) invalid('RESULT_INVALID');
  validateSnapshotBinding(snapshot, contextId, expectedSnapshotHash);
  const selection = selectCurrentCorpus(corpus, currentSources);
  let candidates: unknown[];
  try { const parsed = object(JSON.parse(raw)); if (parsed.schemaVersion !== REVIEW_SCHEMA) invalid(); candidates = array(parsed.findings, RESULT_LIMITS.findings); }
  catch { return invalid('RESULT_INVALID'); }
  const limitations: ValidatedResult['limitations'] = [];
  if (snapshot.status === 'partial') limitations.push('PARTIAL_EXTRACTION');
  if (!selection.entries.length) limitations.push('CORPUS_UNAVAILABLE');
  if (selection.entries.some(e => !e.translation || e.translation.status !== 'human_reviewed')) limitations.push('UNREVIEWED_TRANSLATION');
  const result: ValidatedResult = { schemaVersion: REVIEW_SCHEMA, status: 'unconfirmed', findings: [], quarantined: [], rawHash: sha256(raw), corpusReleaseId: selection.releaseId, corpusManifestHash: selection.manifestHash, inputSnapshotHash: expectedSnapshotHash, limitations, requiresHumanReview: true, legalApproval: false };
  if (!supportedScope(snapshot)) return { ...result, status: 'out_of_scope' };
  if (!['read', 'partial'].includes(snapshot.status)) return { ...result, status: 'unread' };
  for (const [index, candidate] of candidates.entries()) {
    try {
      const c = object(candidate);
      if (typeof c.category !== 'string' || !CATEGORIES.includes(c.category as typeof CATEGORIES[number])) { result.quarantined.push({ index, issue: 'CATEGORY_UNSUPPORTED' }); continue; }
      const category = oneOf(c.category, CATEGORIES), original = validateInputQuote(snapshot, contextId, expectedSnapshotHash, c.original);
      const risk = oneOf(c.risk, ['low', 'medium', 'high', 'unknown']), confidence = c.confidence;
      if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) invalid();
      const evidence = citations(c.citations, selection);
      const finding: Finding = { id: `finding-${index + 1}`, category, original, risk, confidence, reason: text(c.reason, 4000), additionalInformation: array(c.additionalInformation, 20).map(v => text(v, 1000)), suggestion: c.suggestion === null ? null : text(c.suggestion, 4000),
        legalBasis: evidence.confirmed.filter(c => c.channel === 'legal_basis'), supportingGuidance: evidence.confirmed.filter(c => c.channel === 'supporting_guidance'), evidenceStatus: evidence.unconfirmed || !evidence.confirmed.some(c => c.channel === 'legal_basis') ? 'unconfirmed' : 'confirmed_locator', unconfirmedCitationCount: evidence.unconfirmed, humanReviewRequired: true };
      result.findings.push(finding);
    } catch (error) { result.quarantined.push({ index, issue: error instanceof ReviewContractError && error.code === 'LOCATION_INVALID' ? 'QUOTE_UNCONFIRMED' : 'FINDING_MALFORMED' }); }
  }
  result.status = !selection.entries.length || result.quarantined.length || result.findings.some(f => f.evidenceStatus === 'unconfirmed') ? 'unconfirmed' : result.findings.length ? 'candidates' : 'no_candidates';
  return result;
}
